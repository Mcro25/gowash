const crypto = require('node:crypto');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const { generateCode } = require('./promoService');
const { logSecurityEvent } = require('./auditService');
const { hashIp } = require('../middleware/rateLimiter');

async function generateQrDataUrl(qrToken) {
  if (!qrToken) return null;
  const verifyPath = `/verify/${qrToken}`;
  try {
    return await QRCode.toDataURL(verifyPath, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 260,
      color: {
        dark: '#002B49',
        light: '#FFFFFF'
      }
    });
  } catch (e) {
    console.error('Failed to generate QR Code Data URL:', e);
    return null;
  }
}

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

// Saudi phone normalization & validation
// Saudi phone parsing, normalization & masking
function parseSaudiPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  let cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('+966')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('00966')) {
    cleaned = '0' + cleaned.slice(5);
  } else if (cleaned.startsWith('966')) {
    cleaned = '0' + cleaned.slice(3);
  }
  // If user entered 5xxxxxxxx (9 digits), prepend 0
  if (/^5[0-9]{8}$/.test(cleaned)) {
    cleaned = '0' + cleaned;
  }
  // Must be 10 digits starting with 05
  if (/^05[0-9]{8}$/.test(cleaned)) {
    const local = cleaned;
    const normalized = '+966' + cleaned.slice(1);
    const masked = `${cleaned.slice(0, 2)}••••${cleaned.slice(6)}`;
    return { local, normalized, masked };
  }
  return null;
}

function normalizeSaudiPhone(rawPhone) {
  const parsed = parseSaudiPhone(rawPhone);
  return parsed ? parsed.local : null;
}

function validateName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  const trimmed = rawName.trim().replace(/<[^>]*>/g, '');
  if (trimmed.length < 2 || trimmed.length > 70) return null;
  return trimmed;
}

// Handle Participant Entry Screen (Upfront Registration & Duplicate Check)
async function handleParticipantEntry({ participantId, name, phone, ip, userAgent }) {
  const ipH = hashIp(ip);
  const nowIso = new Date().toISOString();

  // 1. Check Campaign Status
  const campaign = await db.get('SELECT status, start_date, end_date FROM campaign_settings WHERE id = 1');
  if (!campaign) {
    return { success: false, code: 'CAMPAIGN_NOT_FOUND', error: 'إعدادات الفعالية غير متاحة حالياً.' };
  }
  if (campaign.status === 'PAUSED') {
    return { success: false, code: 'CAMPAIGN_PAUSED', error: 'الفعالية متوقفة مؤقتاً في الوقت الحالي.' };
  }
  if (campaign.status === 'ENDED') {
    return { success: false, code: 'CAMPAIGN_ENDED', error: 'انتهت فعالية اليوم الوطني السعودي 96.' };
  }

  // 2. Validate Name & Phone
  const validName = validateName(name);
  if (!validName) {
    return { success: false, code: 'INVALID_NAME', error: 'يرجى إدخال اسمك الكريم (حرفين على الأقل وبحد أقصى 70 حرفاً).' };
  }

  const parsedPhone = parseSaudiPhone(phone);
  if (!parsedPhone) {
    return { success: false, code: 'INVALID_PHONE', error: 'يرجى إدخال رقم جوال سعودي صحيح يبدأ بـ 05 ويتكون من 10 أرقام (مثال: 0580700242).' };
  }

  // 3. Check if this phone number already participated and spun in this campaign
  const existingPhoneSpin = await db.get(`
    SELECT s.id, s.created_at as spin_created_at, pr.id as prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           p.code as promo_code, p.expires_at as promo_expires_at, p.status as promo_status, p.redeemed_at as promo_redeemed_at,
           p.qr_token as promo_qr_token,
           pt.id as participant_id, pt.name as participant_name, pt.phone as participant_phone, pt.normalized_phone
    FROM spins s
    JOIN participants pt ON s.participant_id = pt.id
    JOIN prizes pr ON s.prize_id = pr.id
    LEFT JOIN promo_codes p ON s.id = p.spin_id
    WHERE pt.normalized_phone = ? OR pt.phone = ?
  `, [parsedPhone.normalized, parsedPhone.local]);

  if (existingPhoneSpin) {
    const qrDataUrl = await generateQrDataUrl(existingPhoneSpin.promo_qr_token);
    return {
      success: true,
      alreadyParticipated: true,
      participant: {
        name: existingPhoneSpin.participant_name || validName,
        phone: parsedPhone.masked
      },
      existingPrize: {
        id: existingPhoneSpin.prize_id,
        label: existingPhoneSpin.prize_label,
        type: existingPhoneSpin.prize_type,
        subtext: existingPhoneSpin.prize_subtext,
        code: existingPhoneSpin.promo_code,
        status: existingPhoneSpin.promo_status || 'ACTIVE',
        expiresAt: existingPhoneSpin.promo_expires_at,
        redeemedAt: existingPhoneSpin.promo_redeemed_at,
        qrToken: existingPhoneSpin.promo_qr_token || null,
        qrDataUrl,
        participant: {
          name: existingPhoneSpin.participant_name || validName,
          phone: parsedPhone.masked
        }
      }
    };
  }

  // 4. Save or update participant record
  const existingByPhone = await db.get(
    'SELECT id FROM participants WHERE (normalized_phone = ? OR phone = ?) AND campaign_id = ?',
    [parsedPhone.normalized, parsedPhone.local, 'national_day_96']
  );

  let finalParticipantId = participantId;

  if (existingByPhone) {
    finalParticipantId = existingByPhone.id;
    await db.run(`
      UPDATE participants
      SET name = ?, phone = ?, normalized_phone = ?, last_seen_at = ?, ip_hash = ?, user_agent = ?
      WHERE id = ?
    `, [validName, parsedPhone.local, parsedPhone.normalized, nowIso, ipH, userAgent || '', existingByPhone.id]);
  } else {
    const existingParticipant = await db.get('SELECT id FROM participants WHERE id = ?', [participantId]);
    if (existingParticipant) {
      await db.run(`
        UPDATE participants
        SET name = ?, phone = ?, normalized_phone = ?, campaign_id = 'national_day_96', last_seen_at = ?, ip_hash = ?, user_agent = ?
        WHERE id = ?
      `, [validName, parsedPhone.local, parsedPhone.normalized, nowIso, ipH, userAgent || '', participantId]);
    } else {
      await db.run(`
        INSERT INTO participants (id, name, phone, normalized_phone, campaign_id, first_seen_at, last_seen_at, ip_hash, user_agent)
        VALUES (?, ?, ?, ?, 'national_day_96', ?, ?, ?, ?)
      `, [participantId, validName, parsedPhone.local, parsedPhone.normalized, nowIso, nowIso, ipH, userAgent || '']);
    }
  }

  return {
    success: true,
    alreadyParticipated: false,
    participant: {
      id: finalParticipantId,
      name: validName,
      phone: parsedPhone.masked,
      normalizedPhone: parsedPhone.normalized
    }
  };
}

// Record participant terms consent
async function recordConsent({ participantId, campaignId = 'national_day_96', termsVersion, ip }) {
  const ipH = hashIp(ip);
  const nowIso = new Date().toISOString();
  const consentId = crypto.randomUUID();

  await db.run(`
    INSERT INTO participant_consents (id, participant_id, campaign_id, terms_version, accepted_at, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [consentId, participantId, campaignId, termsVersion || config.CURRENT_TERMS_VERSION, nowIso, ipH]);

  return { success: true, consentId };
}

// Get participant's persistent result state for GET /api/my-result
async function getMyResult(participantId) {
  if (!participantId) {
    return { success: true, status: 'NO_SPIN' };
  }

  const spin = await db.get(`
    SELECT s.id as spin_id, s.created_at as spin_created_at, pr.id as prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           p.code as promo_code, p.expires_at as promo_expires_at, p.status as promo_status, p.redeemed_at as promo_redeemed_at,
           p.qr_token as promo_qr_token,
           pt.name as participant_name, pt.phone as participant_phone
    FROM spins s
    JOIN prizes pr ON s.prize_id = pr.id
    LEFT JOIN promo_codes p ON s.id = p.spin_id
    LEFT JOIN participants pt ON s.participant_id = pt.id
    WHERE s.participant_id = ?
  `, [participantId]);

  if (!spin) {
    return { success: true, status: 'NO_SPIN' };
  }

  const now = new Date();
  let status = 'ALREADY_SPUN';

  if (spin.promo_status === 'REDEEMED') {
    status = 'REDEEMED';
  } else if (spin.promo_status === 'EXPIRED' || (spin.promo_expires_at && new Date(spin.promo_expires_at) < now)) {
    status = 'EXPIRED';
  }

  const qrDataUrl = await generateQrDataUrl(spin.promo_qr_token);

  return {
    success: true,
    status,
    spinId: spin.spin_id,
    participantId,
    createdAt: spin.promo_created_at || spin.spin_created_at,
    prize: {
      id: spin.prize_id,
      label: spin.prize_label,
      type: spin.prize_type,
      subtext: spin.prize_subtext
    },
    promo: {
      code: spin.promo_code,
      createdAt: spin.promo_created_at || spin.spin_created_at,
      expiresAt: spin.promo_expires_at,
      redeemedAt: spin.promo_redeemed_at,
      status: spin.promo_status,
      qrToken: spin.promo_qr_token || null,
      verifyUrl: spin.promo_qr_token ? `/verify/${spin.promo_qr_token}` : null,
      qrDataUrl
    },
    participant: {
      name: spin.participant_name,
      phone: spin.participant_phone,
      maskedPhone: spin.participant_phone ? (parseSaudiPhone(spin.participant_phone)?.masked || spin.participant_phone) : ''
    }
  };
}

async function checkPrizeByPhone(rawPhone) {
  const parsedPhone = parseSaudiPhone(rawPhone);
  if (!parsedPhone) {
    return { success: false, code: 'INVALID_PHONE', message: 'يرجى إدخال رقم جوال سعودي صحيح (مثال: 0580700242).' };
  }
  const spin = await db.get(`
    SELECT s.id, pr.id as prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           p.code as promo_code, p.expires_at as promo_expires_at, p.status as promo_status, p.redeemed_at as promo_redeemed_at,
           p.qr_token as promo_qr_token,
           pt.name as participant_name, pt.phone as participant_phone
    FROM spins s
    JOIN participants pt ON s.participant_id = pt.id
    JOIN prizes pr ON s.prize_id = pr.id
    LEFT JOIN promo_codes p ON s.id = p.spin_id
    WHERE pt.phone = ? OR pt.normalized_phone = ?
  `, [parsedPhone.local, parsedPhone.normalized]);

  if (!spin) {
    return { success: false, code: 'NOT_FOUND', message: 'لا توجد جائزة مسجلة بهذا الرقم في فعالية اليوم الوطني 96.' };
  }

  const qrDataUrl = await generateQrDataUrl(spin.promo_qr_token);

  return {
    success: true,
    prize: {
      id: spin.prize_id,
      label: spin.prize_label,
      type: spin.prize_type,
      subtext: spin.prize_subtext
    },
    promo: {
      code: spin.promo_code,
      expiresAt: spin.promo_expires_at,
      redeemedAt: spin.promo_redeemed_at,
      status: spin.promo_status,
      qrToken: spin.promo_qr_token || null,
      verifyUrl: spin.promo_qr_token ? `/verify/${spin.promo_qr_token}` : null,
      qrDataUrl
    },
    participant: {
      name: spin.participant_name,
      phone: spin.participant_phone,
      maskedPhone: parsedPhone.masked
    }
  };
}

async function executeSpin({ participantId, idempotencyKey, ip, userAgent, termsAccepted, termsVersion, name, phone }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const ipH = hashIp(ip);

  // 1. Validate Campaign Status First
  const campaign = await db.get('SELECT status, start_date, end_date, max_spins_per_participant FROM campaign_settings WHERE id = 1');
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
  let hasValidConsent = Boolean(termsAccepted && termsVersion === config.CURRENT_TERMS_VERSION);
  if (!hasValidConsent && participantId) {
    const consentRow = await db.get(
      'SELECT id FROM participant_consents WHERE participant_id = ? AND terms_version = ?',
      [participantId, config.CURRENT_TERMS_VERSION]
    );
    if (consentRow) {
      hasValidConsent = true;
    }
  }

  if (!hasValidConsent) {
    if (termsVersion && termsVersion !== config.CURRENT_TERMS_VERSION) {
      return {
        success: false,
        code: 'TERMS_VERSION_MISMATCH',
        message: 'يرجى مراجعة وتأكيد النسخة الأحدث من الشروط والأحكام (1.1).'
      };
    }
    return {
      success: false,
      code: 'TERMS_NOT_ACCEPTED',
      message: 'يجب الموافقة على الشروط والأحكام للمشاركة في الفعالية.'
    };
  }

  // 3. Enforce and Validate Name and Saudi Phone (Mandatory before Spin)
  let validName = validateName(name);
  let parsedPhone = parseSaudiPhone(phone);

  if ((!validName || !parsedPhone) && participantId) {
    const savedP = await db.get('SELECT name, phone, normalized_phone FROM participants WHERE id = ?', [participantId]);
    if (savedP) {
      if (!validName && savedP.name) validName = savedP.name;
      if (!parsedPhone && (savedP.phone || savedP.normalized_phone)) {
        parsedPhone = parseSaudiPhone(savedP.normalized_phone || savedP.phone);
      }
    }
  }

  if (!validName) {
    return {
      success: false,
      code: 'INVALID_NAME',
      message: 'يرجى إدخال اسمك الكريم (حرفين على الأقل).'
    };
  }

  if (!parsedPhone) {
    return {
      success: false,
      code: 'INVALID_PHONE',
      message: 'يرجى إدخال رقم جوال سعودي صحيح يبدأ بـ 05 ويتكون من 10 أرقام (مثال: 0580700242).'
    };
  }

  const validPhone = parsedPhone.local;
  const normalizedPhone = parsedPhone.normalized;

  // 4. Check Idempotency Key
  if (idempotencyKey) {
    const existingIdempotent = await db.get(`
      SELECT s.id, s.prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
             p.code as promo_code, p.expires_at as promo_expires_at
      FROM spins s
      JOIN prizes pr ON s.prize_id = pr.id
      JOIN promo_codes p ON s.id = p.spin_id
      WHERE s.participant_id = ? AND s.idempotency_key = ?
    `, [participantId, idempotencyKey]);

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
        },
        participant: {
          name: validName,
          phone: parsedPhone.masked
        }
      };
    }
  }

  // 5. Check if Phone Number Already Spun
  if (validPhone) {
    const existingPhoneSpin = await db.get(`
      SELECT s.id, s.prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
             p.code as promo_code, p.expires_at as promo_expires_at, pt.name, pt.phone, pt.normalized_phone
      FROM spins s
      JOIN participants pt ON s.participant_id = pt.id
      JOIN prizes pr ON s.prize_id = pr.id
      LEFT JOIN promo_codes p ON s.id = p.spin_id
      WHERE pt.phone = ? OR pt.normalized_phone = ?
    `, [validPhone, normalizedPhone]);

    if (existingPhoneSpin) {
      await logSecurityEvent(ipH, participantId, 'DUPLICATE_PHONE_SPIN_ATTEMPT', `Phone ${validPhone} attempted to spin again`);
      return {
        success: false,
        code: 'ALREADY_SPUN',
        message: 'تم استهلاك فرصة التدوير الخاصة بهذا الرقم في فعالية اليوم الوطني 96.',
        existingPrize: {
          id: existingPhoneSpin.prize_id,
          label: existingPhoneSpin.prize_label,
          type: existingPhoneSpin.prize_type,
          subtext: existingPhoneSpin.prize_subtext,
          code: existingPhoneSpin.promo_code,
          expiresAt: existingPhoneSpin.promo_expires_at,
          participant: {
            name: existingPhoneSpin.name,
            phone: parsedPhone.masked
          }
        }
      };
    }
  }

  // 6. Pre-check Participant Cookie ID Spin Limit
  const existingSpin = await db.get(`
    SELECT s.id, s.prize_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           p.code as promo_code, p.expires_at as promo_expires_at
    FROM spins s
    JOIN prizes pr ON s.prize_id = pr.id
    LEFT JOIN promo_codes p ON s.id = p.spin_id
    WHERE s.participant_id = ?
  `, [participantId]);

  if (existingSpin) {
    await logSecurityEvent(ipH, participantId, 'DUPLICATE_SPIN_ATTEMPT', 'Participant attempted to spin again');
    return {
      success: false,
      code: 'ALREADY_SPUN',
      message: 'تم استهلاك فرصة التدوير الخاصة بك في فعالية اليوم الوطني 96.',
      existingPrize: {
        id: existingSpin.prize_id,
        label: existingSpin.prize_label,
        type: existingSpin.prize_type,
        subtext: existingSpin.prize_subtext,
        code: existingSpin.promo_code,
        expiresAt: existingSpin.promo_expires_at
      }
    };
  }

  // 7. Query active prizes
  const prizes = await db.all(`
    SELECT id, label, type, amount, subtext, probability, display_order
    FROM prizes
    WHERE is_active = 1
    ORDER BY display_order ASC
  `);

  if (!prizes || prizes.length === 0) {
    return { success: false, code: 'NO_PRIZES', message: 'لا توجد جوائز متاحة حالياً.' };
  }

  // 8. Select prize using server-side secure random
  const winningPrize = selectPrize(prizes);
  const spinId = crypto.randomUUID();
  const promoId = crypto.randomUUID();
  const promoCode = await generateCode();
  const qrToken = crypto.randomBytes(16).toString('hex');

  const expiresDate = new Date(now.getTime() + config.PROMO_EXPIRY_HOURS * 3600000);
  const expiresIso = expiresDate.toISOString();

  // 9. Execute Atomic Transaction for 100% Concurrency Safety
  try {
    const result = await db.transaction(async (tx) => {
      // Double-check inside transaction lock for participant_id
      const checkCount = await tx.get('SELECT COUNT(*) as count FROM spins WHERE participant_id = ?', [participantId]);
      if (parseInt(checkCount.count, 10) > 0) {
        throw new Error('ALREADY_SPUN_CONCURRENT');
      }

      // Double-check inside transaction lock for phone
      if (validPhone) {
        const checkPhone = await tx.get(`
          SELECT COUNT(*) as count 
          FROM spins s 
          JOIN participants pt ON s.participant_id = pt.id 
          WHERE pt.phone = ? OR pt.normalized_phone = ?
        `, [validPhone, normalizedPhone]);
        if (checkPhone && parseInt(checkPhone.count, 10) > 0) {
          throw new Error('ALREADY_SPUN_CONCURRENT_PHONE');
        }
      }

      // Update or insert participant record with verified name, phone and normalized_phone
      const existingP = await tx.get('SELECT id FROM participants WHERE id = ?', [participantId]);
      if (existingP) {
        await tx.run('UPDATE participants SET name = ?, phone = ?, normalized_phone = ?, campaign_id = ?, last_seen_at = ? WHERE id = ?',
          [validName, validPhone, normalizedPhone, 'national_day_96', nowIso, participantId]);
      } else {
        await tx.run('INSERT INTO participants (id, name, phone, normalized_phone, campaign_id, first_seen_at, last_seen_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [participantId, validName, validPhone, normalizedPhone, 'national_day_96', nowIso, nowIso, ipH, userAgent || '']);
      }

      // Insert spin record
      await tx.run(`
        INSERT INTO spins (id, participant_id, prize_id, idempotency_key, created_at, ip_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [spinId, participantId, winningPrize.id, idempotencyKey || null, nowIso, ipH]);

      // Record consent
      const consentId = crypto.randomUUID();
      await tx.run(`
        INSERT INTO participant_consents (id, participant_id, campaign_id, terms_version, accepted_at, ip_hash)
        VALUES (?, ?, 'national_day_96', ?, ?, ?)
      `, [consentId, participantId, termsVersion, nowIso, ipH]);

      // Insert promo code with qr_token
      await tx.run(`
        INSERT INTO promo_codes (id, code, spin_id, prize_id, participant_id, status, created_at, expires_at, qr_token)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      `, [promoId, promoCode, spinId, winningPrize.id, participantId, nowIso, expiresIso, qrToken]);

      return true;
    });

    const qrDataUrl = await generateQrDataUrl(qrToken);

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
        expiresAt: expiresIso,
        qrToken,
        verifyUrl: `/verify/${qrToken}`,
        qrDataUrl
      },
      participant: {
        name: validName,
        phone: validPhone,
        maskedPhone: parsedPhone.masked
      }
    };
  } catch (err) {
    if (err.message === 'ALREADY_SPUN_CONCURRENT' || err.message === 'ALREADY_SPUN_CONCURRENT_PHONE' ||
        (err.message && (err.message.includes('UNIQUE constraint') || err.message.includes('duplicate key') || err.message.includes('SQLITE_CONSTRAINT')))) {
      await logSecurityEvent(ipH, participantId, 'RACE_CONDITION_CONSTRAINT_TRIPPED', err.message);
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
  executeSpin,
  checkPrizeByPhone,
  getMyResult,
  recordConsent,
  handleParticipantEntry,
  parseSaudiPhone,
  normalizeSaudiPhone,
  validateName
};
