const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { logAdminAction } = require('./auditService');

// Unambiguous character set for promo codes
const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateCode() {
  const bytes = crypto.randomBytes(5);
  let result = 'GW96-';
  for (let i = 0; i < 5; i++) {
    result += CHARS[bytes[i] % CHARS.length];
  }
  return result;
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

module.exports = {
  generateCode,
  redeemPromoCode,
  cancelPromoCode
};
