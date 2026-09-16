const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { generateCode } = require('./promoService');
const { logSecurityEvent } = require('./auditService');
const { hashIp } = require('../middleware/rateLimiter');

// Cryptographically secure prize selection
function selectPrize(prizes) {
  const totalProbability = prizes.reduce((acc, p) => acc + Number(p.probability), 0);
  if (totalProbability <= 0) {
    throw new Error('No valid prize probabilities configured');
  }

  // Generate integer in range [0, 1000000) for high precision
  const randomVal = (crypto.randomInt(0, 1000000) / 1000000) * totalProbability;
  let cumulative = 0;

  for (const prize of prizes) {
    cumulative += Number(prize.probability);
    if (randomVal < cumulative) {
      return prize;
    }
  }

  return prizes[prizes.length - 1];
}

function executeSpin({ participantId, idempotencyKey, ip, userAgent, termsAccepted, termsVersion }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const ipH = hashIp(ip);

  // 1. Validate Campaign Status First
  const campaign = db.prepare('SELECT status, start_date, end_date, max_spins_per_participant FROM campaign_settings WHERE id = 1').get();
  if (!campaign) {
    return { success: false, code: 'CAMPAIGN_NOT_FOUND', message: 'إعدادات الفعالية غير متاحة حالياً.' };
  }

  if (campaign.status === 'PAUSED') {
    return { success: false, code: 'CAMPAIGN_PAUSED', message: 'الفعالية متوقفة مؤقتاً في الوقت الحالي.' };
  }

  if (campaign.status === 'ENDED') {
    return { success: false, code: 'CAMPAIGN_ENDED', message: 'انتهت فعالية اليوم الوطني السعودي 96.' };
  }

  if (campaign.start_date && now < new Date(campaign.start_date)) {
    return { success: false, code: 'CAMPAIGN_NOT_STARTED', message: 'لم تبدأ الفعالية بعد.' };
  }

  if (campaign.end_date && now > new Date(campaign.end_date)) {
    return { success: false, code: 'CAMPAIGN_EXPIRED', message: 'انتهت فترة فعالية اليوم الوطني 96.' };
  }

  // 2. Enforce Server-side Terms Consent
  if (!termsAccepted || termsVersion !== config.CURRENT_TERMS_VERSION) {
    return {
      success: false,
      code: 'TERMS_NOT_ACCEPTED',
      message: 'يجب الموافقة على الشروط والأحكام للمشاركة في الفعالية.'
    };
  }

  // 2. Check Idempotency Key
  if (idempotencyKey) {
    const existingIdempotent = db.prepare(`
      SELECT s.id, s.prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
             p.code as promo_code, p.expires_at as promo_expires_at
      FROM spins s
      JOIN prizes pr ON s.prize_id = pr.id
      JOIN promo_codes p ON s.id = p.spin_id
      WHERE s.participant_id = ? AND s.idempotency_key = ?
    `).get(participantId, idempotencyKey);

    if (existingIdempotent) {
      return {
        success: true,
        replayed: true,
        prize: {
          id: existingIdempotent.prize_id,
          label: existingIdempotent.prize_label,
          type: existingIdempotent.prize_type,
          subtext: existingIdempotent.prize_subtext
        },
        promo: {
          code: existingIdempotent.promo_code,
          expiresAt: existingIdempotent.promo_expires_at
        }
      };
    }
  }

  // 3. Pre-check Participant Spin Limit
  const existingSpin = db.prepare(`
    SELECT s.id, s.prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           p.code as promo_code
    FROM spins s
    JOIN prizes pr ON s.prize_id = pr.id
    LEFT JOIN promo_codes p ON s.id = p.spin_id
    WHERE s.participant_id = ?
  `).get(participantId);

  if (existingSpin) {
    logSecurityEvent(ipH, participantId, 'DUPLICATE_SPIN_ATTEMPT', 'Participant attempted to spin again');
    return {
      success: false,
      code: 'ALREADY_SPUN',
      message: 'تم استهلاك فرصة التدوير الخاصة بك في فعالية اليوم الوطني 96.',
      existingPrize: {
        label: existingSpin.prize_label,
        code: existingSpin.promo_code
      }
    };
  }

  // 4. Query active prizes
  const prizes = db.prepare(`
    SELECT id, label, type, amount, subtext, probability, display_order
    FROM prizes
    WHERE is_active = 1
    ORDER BY display_order ASC
  `).all();

  if (!prizes || prizes.length === 0) {
    return { success: false, code: 'NO_PRIZES', message: 'لا توجد جوائز متاحة حالياً.' };
  }

  // 5. Select prize using server-side secure random
  const winningPrize = selectPrize(prizes);
  const spinId = crypto.randomUUID();
  const promoId = crypto.randomUUID();
  const promoCode = generateCode();

  const expiresDate = new Date(now.getTime() + config.PROMO_EXPIRY_HOURS * 3600000);
  const expiresIso = expiresDate.toISOString();

  // 6. Execute Atomic Transaction (BEGIN IMMEDIATE guarantees concurrency lock)
  let inTransaction = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;

    // Double-check inside transaction lock
    const checkCount = db.prepare('SELECT COUNT(*) as count FROM spins WHERE participant_id = ?').get(participantId);
    if (checkCount.count > 0) {
      db.exec('ROLLBACK');
      inTransaction = false;
      logSecurityEvent(ipH, participantId, 'CONCURRENT_SPIN_BLOCKED', 'Concurrent spin blocked by atomic check');
      return {
        success: false,
        code: 'ALREADY_SPUN',
        message: 'تم استهلاك فرصة التدوير الخاصة بك في فعالية اليوم الوطني 96.'
      };
    }

    // Insert spin record
    db.prepare(`
      INSERT INTO spins (id, participant_id, prize_id, idempotency_key, created_at, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(spinId, participantId, winningPrize.id, idempotencyKey || null, nowIso, ipH);

    // Record consent
    const consentId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO participant_consents (id, participant_id, campaign_id, terms_version, accepted_at, ip_hash)
      VALUES (?, ?, 'national_day_96', ?, ?, ?)
    `).run(consentId, participantId, termsVersion, nowIso, ipH);

    // Insert promo code
    db.prepare(`
      INSERT INTO promo_codes (id, code, spin_id, prize_id, participant_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(promoId, promoCode, spinId, winningPrize.id, participantId, nowIso, expiresIso);

    db.exec('COMMIT');
    inTransaction = false;

    // Return sanitized result to client without internal weights
    return {
      success: true,
      prize: {
        id: winningPrize.id,
        label: winningPrize.label,
        type: winningPrize.type,
        subtext: winningPrize.subtext
      },
      promo: {
        code: promoCode,
        expiresAt: expiresIso
      }
    };
  } catch (err) {
    if (inTransaction) {
      try { db.exec('ROLLBACK'); } catch (e) {}
    }

    // If duplicate constraint on participant_id
    if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('SQLITE_CONSTRAINT'))) {
      logSecurityEvent(ipH, participantId, 'RACE_CONDITION_CONSTRAINT_TRIPPED', err.message);
      return {
        success: false,
        code: 'ALREADY_SPUN',
        message: 'تم استهلاك فرصة التدوير الخاصة بك في فعالية اليوم الوطني 96.'
      };
    }

    console.error('Spin execution error:', err);
    return {
      success: false,
      code: 'SERVER_ERROR',
      message: 'حدث خطأ غير متوقع أثناء السحب. يرجى المحاولة مرة أخرى.'
    };
  }
}

module.exports = {
  executeSpin
};
