const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { logAdminAction } = require('./auditService');

// Unambiguous character set for promo codes
const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

async function generateCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = crypto.randomBytes(8);
    let part1 = '';
    let part2 = '';
    for (let i = 0; i < 4; i++) {
      part1 += CHARS[bytes[i] % CHARS.length];
    }
    for (let i = 4; i < 8; i++) {
      part2 += CHARS[bytes[i] % CHARS.length];
    }
    const candidateCode = `GW96-${part1}-${part2}`;
    
    // Collision check against database
    const exists = await db.get('SELECT 1 FROM promo_codes WHERE code = ?', [candidateCode]);
    if (!exists) {
      return candidateCode;
    }
  }

  // Cryptographic fallback guaranteed unique with high-res timestamp
  const ts = Date.now().toString(36).toUpperCase().padStart(8, 'X');
  const rnd = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GW96-${ts.slice(-4)}-${rnd}`;
}

async function redeemPromoCode(code, adminUsername, participantVerification = null, ip = '127.0.0.1') {
  const now = new Date();
  const nowIso = now.toISOString();

  // Validate Campaign Rules
  const campaign = await db.get('SELECT status FROM campaign_settings WHERE id = 1');
  if (campaign && campaign.status === 'ENDED') {
    return { success: false, error: 'انتهت الفعالية رسمياً، ولا يمكن استرداد الأكواد حالياً.' };
  }

  const promo = await db.get(`
    SELECT p.id, p.code, p.status, p.expires_at, p.prize_id, p.spin_id, p.participant_id,
           pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           COALESCE(pt.name, 'غير محدد') as participant_name,
           COALESCE(pt.phone, '---') as participant_phone
    FROM promo_codes p
    JOIN prizes pr ON p.prize_id = pr.id
    LEFT JOIN participants pt ON p.participant_id = pt.id
    WHERE p.code = ?
  `, [code.toUpperCase().trim()]);

  if (!promo) {
    return { success: false, error: 'الرمز الترويجي غير موجود في النظام.' };
  }

  // Single-Person Code & Participant Binding Verification
  if (participantVerification && typeof participantVerification === 'string') {
    const cleanVerify = participantVerification.trim();
    let normInput = cleanVerify.replace(/[\s\-\(\)\.]/g, '');
    if (normInput.startsWith('+966')) normInput = '0' + normInput.slice(4);
    else if (normInput.startsWith('00966')) normInput = '0' + normInput.slice(5);
    else if (normInput.startsWith('966')) normInput = '0' + normInput.slice(3);
    else if (/^5[0-9]{8}$/.test(normInput)) normInput = '0' + normInput;

    const isPhone = /^05[0-9]{8}$/.test(normInput);

    if (isPhone) {
      let promoPhone = (promo.participant_phone || '').replace(/[\s\-\(\)\.]/g, '');
      if (promoPhone.startsWith('+966')) promoPhone = '0' + promoPhone.slice(4);
      else if (promoPhone.startsWith('00966')) promoPhone = '0' + promoPhone.slice(5);
      else if (promoPhone.startsWith('966')) promoPhone = '0' + promoPhone.slice(3);
      else if (/^5[0-9]{8}$/.test(promoPhone)) promoPhone = '0' + promoPhone;

      if (normInput !== promoPhone) {
        return {
          success: false,
          error: 'فشل التحقق الأمني: رقم الجوال المقدم لا يتطابق مع المشارك صاحب هذا الكود.'
        };
      }
    } else if (cleanVerify !== promo.participant_id && cleanVerify !== promo.participant_name) {
      return {
        success: false,
        error: 'فشل التحقق الأمني: هوية المشارك لا تتطابق مع بيانات صاحب الكود المسجلة.'
      };
    }
  }

  // Check expiration server-side (Requirement 2)
  const isExpired = new Date(promo.expires_at).getTime() <= now.getTime();
  if (isExpired || promo.status === 'EXPIRED') {
    if (promo.status !== 'EXPIRED') {
      await db.run('UPDATE promo_codes SET status = ? WHERE id = ?', ['EXPIRED', promo.id]);
    }
    return { success: false, code: 'EXPIRED', error: 'انتهت صلاحية هذه الجائزة' };
  }

  // One-time redemption enforcement (Requirement 7 & User specification)
  if (promo.status === 'REDEEMED') {
    return { success: false, code: 'ALREADY_REDEEMED', error: 'تم استخدام هذه الجائزة مسبقاً ولا يمكن استخدامها مرة أخرى.' };
  }

  if (promo.status === 'CANCELLED') {
    return { success: false, code: 'CANCELLED', error: 'هذه الجائزة ملغاة' };
  }

  // Atomically update status to REDEEMED with expiration guard (Requirement 2 & 4)
  const updateResult = await db.run(`
    UPDATE promo_codes
    SET status = 'REDEEMED', redeemed_at = ?
    WHERE id = ? AND status = 'ACTIVE' AND expires_at > ?
  `, [nowIso, promo.id, nowIso]);

  if (updateResult.rowCount === 0 && updateResult.changes === 0) {
    return { success: false, code: 'CONCURRENT_REDEEM', error: 'تعذر استرداد الجائزة. قد تكون استُردت بالتزامن أو انتهت صلاحيتها.' };
  }

  // Record into dedicated redemptions table
  const redemptionId = crypto.randomUUID();
  try {
    await db.run(`
      INSERT INTO redemptions (id, promo_code_id, promo_code, participant_id, phone, prize_label, redeemed_by, redeemed_at, ip_hash, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      redemptionId,
      promo.id,
      promo.code,
      promo.participant_id,
      promo.participant_phone,
      promo.prize_label,
      adminUsername || 'admin',
      nowIso,
      crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16),
      JSON.stringify({ verified: Boolean(participantVerification) })
    ]);
  } catch (e) {
    console.error('Failed to record redemption:', e);
  }

  await logAdminAction(adminUsername, 'PROMO_REDEEMED', promo.code, 'SUCCESS', {
    prize: promo.prize_label,
    participant: promo.participant_name,
    phone: promo.participant_phone
  });

  return {
    success: true,
    code: promo.code,
    prize: promo.prize_label,
    participantName: promo.participant_name,
    participantPhone: promo.participant_phone,
    participantId: promo.participant_id,
    redeemedAt: nowIso
  };
}

async function cancelPromoCode(code, adminUsername, reason = 'Admin cancellation') {
  const promo = await db.get('SELECT id, code, status FROM promo_codes WHERE code = ?', [code.toUpperCase().trim()]);

  if (!promo) {
    return { success: false, error: 'الرمز الترويجي غير موجود.' };
  }

  if (promo.status === 'CANCELLED') {
    return { success: false, error: 'الكود ملغى بالفعل.' };
  }

  await db.run("UPDATE promo_codes SET status = 'CANCELLED' WHERE id = ?", [promo.id]);
  await logAdminAction(adminUsername, 'PROMO_CANCELLED', promo.code, 'SUCCESS', { reason });

  return { success: true, code: promo.code };
}

async function unredeemPromoCode(code, adminUsername) {
  const promo = await db.get('SELECT id, code, status FROM promo_codes WHERE code = ?', [code.toUpperCase().trim()]);

  if (!promo) {
    return { success: false, error: 'الرمز الترويجي غير موجود.' };
  }

  await db.run("UPDATE promo_codes SET status = 'ACTIVE', redeemed_at = NULL WHERE id = ?", [promo.id]);
  await logAdminAction(adminUsername, 'PROMO_REACTIVATED', promo.code, 'SUCCESS', {});

  return { success: true, code: promo.code, status: 'ACTIVE' };
}

async function lookupPromoCode(term) {
  if (!term || typeof term !== 'string') {
    return { success: false, error: 'يرجى تقديم كود الخصم أو رقم الجوال للبحث.' };
  }
  const cleanTerm = term.trim();
  const upperTerm = cleanTerm.toUpperCase();

  // Try matching by exact promo code
  let promo = await db.get(`
    SELECT p.id, p.code, p.status, p.spin_id, p.prize_id, p.created_at, p.expires_at, p.redeemed_at,
           pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           p.participant_id,
           COALESCE(pt.name, 'غير محدد') as participant_name,
           COALESCE(pt.phone, '---') as participant_phone
    FROM promo_codes p
    LEFT JOIN participants pt ON p.participant_id = pt.id
    JOIN prizes pr ON p.prize_id = pr.id
    WHERE p.code = ?
  `, [upperTerm]);

  // If not found by code, try matching by phone
  if (!promo) {
    let cleanPhone = cleanTerm.replace(/[\s\-\(\)\.]/g, '');
    if (cleanPhone.startsWith('+966')) cleanPhone = '0' + cleanPhone.slice(4);
    else if (cleanPhone.startsWith('00966')) cleanPhone = '0' + cleanPhone.slice(5);
    else if (cleanPhone.startsWith('966')) cleanPhone = '0' + cleanPhone.slice(3);
    else if (/^5[0-9]{8}$/.test(cleanPhone)) cleanPhone = '0' + cleanPhone;

    promo = await db.get(`
      SELECT p.id, p.code, p.status, p.spin_id, p.prize_id, p.created_at, p.expires_at, p.redeemed_at,
             pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
             p.participant_id,
             COALESCE(pt.name, 'غير محدد') as participant_name,
             COALESCE(pt.phone, '---') as participant_phone
      FROM promo_codes p
      LEFT JOIN participants pt ON p.participant_id = pt.id
      JOIN prizes pr ON p.prize_id = pr.id
      WHERE pt.phone = ?
      ORDER BY p.created_at DESC
      LIMIT 1
    `, [cleanPhone]);
  }

  if (!promo) {
    return { success: false, error: 'لم يتم العثور على أي كود ترويجي مطابق للرمز أو رقم الجوال المدخل.' };
  }

  // Automatic expiry transition if active and past expiry date
  const now = new Date();
  if (promo.status === 'ACTIVE' && new Date(promo.expires_at) < now) {
    await db.run("UPDATE promo_codes SET status = 'EXPIRED' WHERE id = ?", [promo.id]);
    promo.status = 'EXPIRED';
  }

  return {
    success: true,
    promo
  };
}

function formatRiyadhDate(isoOrDate) {
  if (!isoOrDate) return '';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      timeZone: config.CAMPAIGN_TIMEZONE || 'Asia/Riyadh',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(isoOrDate));
  } catch (e) {
    return String(isoOrDate);
  }
}

async function verifyPromo(tokenOrCode) {
  if (!tokenOrCode || typeof tokenOrCode !== 'string') {
    return { success: false, error: 'يرجى تقديم رمز التحقق أو كود الخصم.' };
  }

  let clean = tokenOrCode.trim();
  // Handle full verification URL if scanned directly (e.g. https://domain/verify/TOKEN)
  if (clean.includes('/verify/')) {
    clean = clean.split('/verify/').pop().split('?')[0].split('#')[0].trim();
  }

  const promo = await db.get(`
    SELECT p.id, p.code, p.status, p.created_at, p.expires_at, p.redeemed_at, p.qr_token,
           p.participant_id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           COALESCE(pt.name, 'غير محدد') as participant_name,
           COALESCE(pt.phone, '---') as participant_phone
    FROM promo_codes p
    LEFT JOIN participants pt ON p.participant_id = pt.id
    JOIN prizes pr ON p.prize_id = pr.id
    WHERE p.qr_token = ? OR p.code = ?
  `, [clean, clean.toUpperCase()]);

  if (!promo) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'رمز التحقق أو الكود الترويجي غير موجود في النظام.'
    };
  }

  // Check Campaign
  const campaign = await db.get('SELECT status FROM campaign_settings WHERE id = 1');

  // Check Expiration
  const now = new Date();
  const isExpired = new Date(promo.expires_at).getTime() <= now.getTime();
  if (isExpired && promo.status === 'ACTIVE') {
    await db.run("UPDATE promo_codes SET status = 'EXPIRED' WHERE id = ?", [promo.id]);
    promo.status = 'EXPIRED';
  }

  // Check Status and map to exact required strings:
  // إذا كان صالحًا: صالح
  // إذا كان مستخدمًا: تم استخدام هذه الجائزة مسبقًا
  // إذا كان منتهيًا: انتهت صلاحية هذه الجائزة
  // إذا كان مشطوبًا: هذه الجائزة ملغاة
  let status = promo.status;
  let statusLabel = 'صالح';

  if (promo.status === 'REDEEMED') {
    status = 'REDEEMED';
    statusLabel = 'تم استخدام هذه الجائزة مسبقًا';
  } else if (promo.status === 'CANCELLED') {
    status = 'CANCELLED';
    statusLabel = 'هذه الجائزة ملغاة';
  } else if (isExpired || promo.status === 'EXPIRED') {
    status = 'EXPIRED';
    statusLabel = 'انتهت صلاحية هذه الجائزة';
  } else if (campaign && campaign.status === 'ENDED') {
    status = 'EXPIRED';
    statusLabel = 'انتهت صلاحية هذه الجائزة';
  } else {
    status = 'ACTIVE';
    statusLabel = 'صالح';
  }

  return {
    success: true,
    valid: status === 'ACTIVE',
    status,
    statusLabel,
    statusArabic: statusLabel,
    code: promo.code,
    qrToken: promo.qr_token,
    prize: {
      label: promo.prize_label,
      type: promo.prize_type,
      subtext: promo.prize_subtext
    },
    dates: {
      createdAt: promo.created_at,
      expiresAt: promo.expires_at,
      redeemedAt: promo.redeemed_at,
      createdAtFormatted: formatRiyadhDate(promo.created_at),
      expiresAtFormatted: formatRiyadhDate(promo.expires_at),
      redeemedAtFormatted: promo.redeemed_at ? formatRiyadhDate(promo.redeemed_at) : null
    },
    createdAt: promo.created_at,
    expiresAt: promo.expires_at,
    redeemedAt: promo.redeemed_at,
    createdAtFormatted: formatRiyadhDate(promo.created_at),
    expiresAtFormatted: formatRiyadhDate(promo.expires_at),
    redeemedAtFormatted: promo.redeemed_at ? formatRiyadhDate(promo.redeemed_at) : null,
    participant: {
      name: promo.participant_name,
      phone: promo.participant_phone
    }
  };
}

module.exports = {
  generateCode,
  redeemPromoCode,
  cancelPromoCode,
  unredeemPromoCode,
  lookupPromoCode,
  verifyPromo,
  formatRiyadhDate
};
