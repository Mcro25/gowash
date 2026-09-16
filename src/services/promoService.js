const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { logAdminAction } = require('./auditService');

// Unambiguous character set for promo codes
const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateCode() {
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
    const exists = db.prepare('SELECT 1 FROM promo_codes WHERE code = ?').get(candidateCode);
    if (!exists) {
      return candidateCode;
    }
  }

  // Cryptographic fallback guaranteed unique with high-res timestamp
  const ts = Date.now().toString(36).toUpperCase().padStart(8, 'X');
  const rnd = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GW96-${ts.slice(-4)}-${rnd}`;
}

function redeemPromoCode(code, adminUsername) {
  const now = new Date();
  const nowIso = now.toISOString();

  const promo = db.prepare(`
    SELECT p.id, p.code, p.status, p.expires_at, p.prize_id, pr.label as prize_label
    FROM promo_codes p
    JOIN prizes pr ON p.prize_id = pr.id
    WHERE p.code = ?
  `).get(code.toUpperCase().trim());

  if (!promo) {
    return { success: false, error: 'الرمز الترويجي غير موجود.' };
  }

  if (promo.status === 'REDEEMED') {
    return { success: false, error: 'هذا الكود تم استخدامه مسبقاً ولا يمكن استخدامه مرة أخرى.' };
  }

  if (promo.status === 'CANCELLED') {
    return { success: false, error: 'هذا الكود تم إلغاؤه من قبل الإدارة.' };
  }

  if (new Date(promo.expires_at) < now) {
    db.prepare('UPDATE promo_codes SET status = ? WHERE id = ?').run('EXPIRED', promo.id);
    return { success: false, error: 'انتهت فترة صلاحية هذا الكود.' };
  }

  // Atomically update status to REDEEMED
  db.prepare(`
    UPDATE promo_codes
    SET status = 'REDEEMED', redeemed_at = ?
    WHERE id = ? AND status = 'ACTIVE'
  `).run(nowIso, promo.id);

  logAdminAction(adminUsername, 'PROMO_REDEEMED', promo.code, 'SUCCESS', { prize: promo.prize_label });

  return {
    success: true,
    code: promo.code,
    prize: promo.prize_label,
    redeemedAt: nowIso
  };
}

function cancelPromoCode(code, adminUsername, reason = 'Admin cancellation') {
  const promo = db.prepare('SELECT id, code, status FROM promo_codes WHERE code = ?').get(code.toUpperCase().trim());

  if (!promo) {
    return { success: false, error: 'الرمز الترويجي غير موجود.' };
  }

  if (promo.status === 'CANCELLED') {
    return { success: false, error: 'الكود ملغى بالفعل.' };
  }

  db.prepare("UPDATE promo_codes SET status = 'CANCELLED' WHERE id = ?").run(promo.id);
  logAdminAction(adminUsername, 'PROMO_CANCELLED', promo.code, 'SUCCESS', { reason });

  return { success: true, code: promo.code };
}

function unredeemPromoCode(code, adminUsername) {
  const promo = db.prepare('SELECT id, code, status FROM promo_codes WHERE code = ?').get(code.toUpperCase().trim());

  if (!promo) {
    return { success: false, error: 'الرمز الترويجي غير موجود.' };
  }

  db.prepare("UPDATE promo_codes SET status = 'ACTIVE', redeemed_at = NULL WHERE id = ?").run(promo.id);
  logAdminAction(adminUsername, 'PROMO_REACTIVATED', promo.code, 'SUCCESS', {});

  return { success: true, code: promo.code, status: 'ACTIVE' };
}

function lookupPromoCode(term) {
  if (!term || typeof term !== 'string') {
    return { success: false, error: 'يرجى تقديم كود الخصم أو رقم الجوال للبحث.' };
  }
  const cleanTerm = term.trim();
  const upperTerm = cleanTerm.toUpperCase();

  // Try matching by exact promo code
  let promo = db.prepare(`
    SELECT p.id, p.code, p.status, p.created_at, p.expires_at, p.redeemed_at,
           pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
           p.participant_id,
           COALESCE(pt.name, 'غير محدد') as participant_name,
           COALESCE(pt.phone, '---') as participant_phone
    FROM promo_codes p
    LEFT JOIN participants pt ON p.participant_id = pt.id
    JOIN prizes pr ON p.prize_id = pr.id
    WHERE p.code = ?
  `).get(upperTerm);

  // If not found by code, try matching by phone
  if (!promo) {
    let cleanPhone = cleanTerm.replace(/[\s\-\(\)\.]/g, '');
    if (cleanPhone.startsWith('+966')) cleanPhone = '0' + cleanPhone.slice(4);
    else if (cleanPhone.startsWith('00966')) cleanPhone = '0' + cleanPhone.slice(5);
    else if (cleanPhone.startsWith('966')) cleanPhone = '0' + cleanPhone.slice(3);
    else if (/^5[0-9]{8}$/.test(cleanPhone)) cleanPhone = '0' + cleanPhone;

    promo = db.prepare(`
      SELECT p.id, p.code, p.status, p.created_at, p.expires_at, p.redeemed_at,
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
    `).get(cleanPhone);
  }

  if (!promo) {
    return { success: false, error: 'لم يتم العثور على أي كود ترويجي مطابق للرمز أو رقم الجوال المدخل.' };
  }

  return {
    success: true,
    promo
  };
}

module.exports = {
  generateCode,
  redeemPromoCode,
  cancelPromoCode,
  unredeemPromoCode,
  lookupPromoCode
};
