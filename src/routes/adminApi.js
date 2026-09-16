const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { requireAdmin, validateCsrf } = require('../middleware/auth');
const { logAdminAction } = require('../services/auditService');
const { redeemPromoCode, cancelPromoCode } = require('../services/promoService');

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
  }

  const user = db.prepare('SELECT id, username, email, password_hash FROM admin_users WHERE username = ? OR email = ?').get(username.trim(), username.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    logAdminAction(username, 'LOGIN_FAILED', null, 'FAILED', { reason: 'Invalid credentials' });
    return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
  }

  // Create admin session
  const sessionId = crypto.randomUUID();
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const expiresIso = new Date(now.getTime() + config.SESSION_EXPIRY_MS).toISOString();

  db.prepare(`
    INSERT INTO admin_sessions (id, admin_id, csrf_token, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, user.id, csrfToken, now.toISOString(), expiresIso);

  res.cookie('gowash_admin_session', sessionId, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: '/',
    maxAge: config.SESSION_EXPIRY_MS
  });

  logAdminAction(user.username, 'LOGIN_SUCCESS', null, 'SUCCESS');

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email
    },
    csrfToken
  });
});

// Protected routes below
router.use(requireAdmin);

// GET /api/admin/me - Verify current session & get CSRF token
router.get('/me', (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.admin.id,
      username: req.admin.username,
      email: req.admin.email
    },
    csrfToken: req.admin.csrfToken
  });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  if (req.admin?.sessionId) {
    db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(req.admin.sessionId);
    logAdminAction(req.admin.username, 'ADMIN_LOGOUT', null, 'SUCCESS');
  }
  res.clearCookie('gowash_admin_session');
  res.json({ success: true });
});

// GET /api/admin/overview - Real database metrics
router.get('/overview', (req, res) => {
  try {
    const totalSpins = db.prepare('SELECT COUNT(*) as count FROM spins').get().count;
    const uniqueParticipants = db.prepare('SELECT COUNT(DISTINCT participant_id) as count FROM spins').get().count;
    const rewardsIssued = db.prepare('SELECT COUNT(*) as count FROM promo_codes').get().count;
    const activeCodes = db.prepare("SELECT COUNT(*) as count FROM promo_codes WHERE status = 'ACTIVE'").get().count;
    const redeemedCodes = db.prepare("SELECT COUNT(*) as count FROM promo_codes WHERE status = 'REDEEMED'").get().count;
    const expiredCodes = db.prepare("SELECT COUNT(*) as count FROM promo_codes WHERE status = 'EXPIRED'").get().count;
    const blockedRequests = db.prepare(`
      SELECT COUNT(*) as count FROM security_logs
      WHERE event_type IN ('RATE_LIMIT_EXCEEDED', 'SPIN_FLOOD_ATTEMPT', 'CONCURRENT_SPIN_BLOCKED')
    `).get().count;

    const campaign = db.prepare('SELECT status, name, start_date, end_date FROM campaign_settings WHERE id = 1').get();

    res.json({
      success: true,
      stats: {
        totalSpins,
        uniqueParticipants,
        rewardsIssued,
        activeCodes,
        redeemedCodes,
        expiredCodes,
        blockedRequests
      },
      campaign: campaign || { status: 'ACTIVE' }
    });
  } catch (err) {
    console.error('Error fetching overview stats:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء تحميل الإحصائيات.' });
  }
});

// GET /api/admin/campaign
router.get('/campaign', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaign_settings WHERE id = 1').get();
  res.json({ success: true, campaign });
});

// PUT /api/admin/campaign
router.put('/campaign', validateCsrf, (req, res) => {
  const { status, name, start_date, end_date, max_spins_per_participant } = req.body || {};

  if (!['ACTIVE', 'PAUSED', 'ENDED'].includes(status)) {
    return res.status(400).json({ success: false, error: 'حالة الفعالية غير صالحة. اختر بين ACTIVE أو PAUSED أو ENDED.' });
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE campaign_settings
    SET status = ?, name = COALESCE(?, name), start_date = ?, end_date = ?,
        max_spins_per_participant = COALESCE(?, max_spins_per_participant), updated_at = ?
    WHERE id = 1
  `).run(status, name || null, start_date || null, end_date || null, max_spins_per_participant || 1, now);

  logAdminAction(req.admin.username, 'CAMPAIGN_STATUS_UPDATED', status, 'SUCCESS', { name, start_date, end_date });

  res.json({ success: true, message: 'تم تحديث إعدادات الحملة بنجاح.' });
});

// POST /api/admin/kill-switch - Instant stop
router.post('/kill-switch', validateCsrf, (req, res) => {
  const now = new Date().toISOString();
  db.prepare("UPDATE campaign_settings SET status = 'PAUSED', updated_at = ? WHERE id = 1").run(now);
  logAdminAction(req.admin.username, 'KILL_SWITCH_TRIGGERED', 'CAMPAIGN_PAUSED', 'SUCCESS', 'Emergency kill switch triggered');

  res.json({ success: true, message: 'تم تفعيل زر الإيقاف الفوري (Kill Switch). تم إيقاف الفعالية فورياً.' });
});

// GET /api/admin/prizes
router.get('/prizes', (req, res) => {
  const prizes = db.prepare('SELECT * FROM prizes ORDER BY display_order ASC').all();
  res.json({ success: true, prizes });
});

// PUT /api/admin/prizes - Strict probability validation (Must equal 100%)
router.put('/prizes', validateCsrf, (req, res) => {
  const { prizes } = req.body || {};

  if (!Array.isArray(prizes) || prizes.length === 0) {
    return res.status(400).json({ success: false, error: 'قائمة الجوائز غير صالحة.' });
  }

  // Validate probability values
  let totalProbability = 0;
  for (const p of prizes) {
    const prob = parseFloat(p.probability);
    if (isNaN(prob) || !isFinite(prob) || prob < 0) {
      return res.status(400).json({
        success: false,
        error: `نسبة غير صالحة للجائزة "${p.label}". يجب أن تكون رقماً موجباً غير سالب.`
      });
    }
    if (p.is_active !== 0) {
      totalProbability += prob;
    }
  }

  // Strict sum check (must equal 100% within 0.001 tolerance)
  if (Math.abs(totalProbability - 100) > 0.001) {
    return res.status(400).json({
      success: false,
      error: `مجموع نسب الاحتمالات للجوائز النشطة هو ${totalProbability.toFixed(2)}%. يجب أن يكون المجموع 100.00% بالضبط لحفظ الإعدادات.`
    });
  }

  // Update inside transaction
  try {
    db.exec('BEGIN IMMEDIATE');
    const updateStmt = db.prepare(`
      UPDATE prizes
      SET label = ?, subtext = ?, probability = ?, is_active = COALESCE(?, 1)
      WHERE id = ?
    `);

    for (const p of prizes) {
      updateStmt.run(p.label, p.subtext, parseFloat(p.probability), p.is_active !== undefined ? p.is_active : 1, p.id);
    }

    db.exec('COMMIT');
    logAdminAction(req.admin.username, 'PROBABILITY_UPDATED', 'prizes', 'SUCCESS', { totalProbability });

    res.json({ success: true, message: 'تم تحديث نسب واحتمالات الجوائز بنجاح.' });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) {}
    console.error('Error updating prizes:', err);
    res.status(500).json({ success: false, error: 'فشل حفظ تعديلات الجوائز.' });
  }
});

// GET /api/admin/spins - Search & pagination
router.get('/spins', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(10, parseInt(req.query.limit || '20', 10)));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  let query = `
    SELECT s.id, s.participant_id, s.created_at, pr.label as prize_label, pr.type as prize_type,
           p.code as promo_code, p.status as promo_status,
           COALESCE(pt.name, 'غير محدد') as participant_name,
           COALESCE(pt.phone, '---') as participant_phone
    FROM spins s
    LEFT JOIN participants pt ON s.participant_id = pt.id
    JOIN prizes pr ON s.prize_id = pr.id
    LEFT JOIN promo_codes p ON s.id = p.spin_id
  `;
  let countQuery = `
    SELECT COUNT(*) as count 
    FROM spins s 
    LEFT JOIN participants pt ON s.participant_id = pt.id
    LEFT JOIN promo_codes p ON s.id = p.spin_id
    JOIN prizes pr ON s.prize_id = pr.id
  `;
  const params = [];

  if (search) {
    query += ` WHERE p.code LIKE ? OR s.participant_id LIKE ? OR pr.label LIKE ? OR pt.name LIKE ? OR pt.phone LIKE ?`;
    countQuery += ` WHERE p.code LIKE ? OR s.participant_id LIKE ? OR pr.label LIKE ? OR pt.name LIKE ? OR pt.phone LIKE ?`;
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }

  query += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;

  const total = db.prepare(countQuery).get(...params).count;
  const records = db.prepare(query).all(...params, limit, offset);

  res.json({
    success: true,
    data: records,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// GET /api/admin/promos - Search & pagination
router.get('/promos', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(10, parseInt(req.query.limit || '20', 10)));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const statusFilter = req.query.status;

  let query = `
    SELECT p.id, p.code, p.status, p.created_at, p.expires_at, p.redeemed_at,
           pr.label as prize_label, p.participant_id,
           COALESCE(pt.name, 'غير محدد') as participant_name,
           COALESCE(pt.phone, '---') as participant_phone
    FROM promo_codes p
    LEFT JOIN participants pt ON p.participant_id = pt.id
    JOIN prizes pr ON p.prize_id = pr.id
  `;
  let countQuery = 'SELECT COUNT(*) as count FROM promo_codes p LEFT JOIN participants pt ON p.participant_id = pt.id';
  const whereClauses = [];
  const params = [];

  if (search) {
    whereClauses.push('(p.code LIKE ? OR p.participant_id LIKE ? OR pt.name LIKE ? OR pt.phone LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  if (statusFilter && ['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED'].includes(statusFilter)) {
    whereClauses.push('p.status = ?');
    params.push(statusFilter);
  }

  if (whereClauses.length > 0) {
    const whereStr = ' WHERE ' + whereClauses.join(' AND ');
    query += whereStr;
    countQuery += whereStr;
  }

  query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;

  const total = db.prepare(countQuery).get(...params).count;
  const records = db.prepare(query).all(...params, limit, offset);

  res.json({
    success: true,
    data: records,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// POST /api/admin/promos/:code/redeem
router.post('/promos/:code/redeem', validateCsrf, (req, res) => {
  const result = redeemPromoCode(req.params.code, req.admin.username);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/admin/promos/:code/cancel
router.post('/promos/:code/cancel', validateCsrf, (req, res) => {
  const result = cancelPromoCode(req.params.code, req.admin.username, req.body?.reason);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// GET /api/admin/security-logs
router.get('/security-logs', (req, res) => {
  const logs = db.prepare('SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 50').all();
  res.json({ success: true, logs });
});

// GET /api/admin/audit-logs
router.get('/audit-logs', (req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50').all();
  res.json({ success: true, logs });
});

// PUT /api/admin/password
router.put('/password', validateCsrf, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم كلمة المرور الحالية والجديدة.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'يجب أن لا تقل كلمة المرور الجديدة عن 8 أحرف.' });
  }

  const user = db.prepare('SELECT password_hash FROM admin_users WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ success: false, error: 'كلمة المرور الحالية غير صحيحة.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const newHash = bcrypt.hashSync(newPassword, salt);

  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(newHash, req.admin.id);
  logAdminAction(req.admin.username, 'PASSWORD_CHANGED', null, 'SUCCESS');

  res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح.' });
});

module.exports = router;
