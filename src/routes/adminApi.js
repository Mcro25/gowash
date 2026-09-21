const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { requireAdmin, validateCsrf } = require('../middleware/auth');
const { loginRateLimiter } = require('../middleware/rateLimiter');
const { logAdminAction } = require('../services/auditService');
const { redeemPromoCode, cancelPromoCode, unredeemPromoCode, lookupPromoCode, verifyPromo } = require('../services/promoService');
const { createBackup } = require('../scripts/backup');

// POST /api/admin/login
router.post('/login', loginRateLimiter(5, 15 * 60 * 1000), async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
    }

    const user = await db.get('SELECT id, username, email, password_hash FROM admin_users WHERE username = ? OR email = ?', [username.trim(), username.trim()]);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      await logAdminAction(username, 'LOGIN_FAILED', null, 'FAILED', { reason: 'Invalid credentials' });
      return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    // Create admin session
    const sessionId = crypto.randomUUID();
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    const expiresIso = new Date(now.getTime() + config.SESSION_EXPIRY_MS).toISOString();

    await db.run(`
      INSERT INTO admin_sessions (id, admin_id, csrf_token, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `, [sessionId, user.id, csrfToken, now.toISOString(), expiresIso]);

    const isSecure = config.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';

    res.cookie('gowash_admin_session', sessionId, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'None' : 'Lax',
      path: '/',
      maxAge: config.SESSION_EXPIRY_MS
    });

    await logAdminAction(user.username, 'LOGIN_SUCCESS', null, 'SUCCESS');

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      csrfToken
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء تسجيل الدخول.' });
  }
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
router.post('/logout', async (req, res) => {
  if (req.admin?.sessionId) {
    await db.run('DELETE FROM admin_sessions WHERE id = ?', [req.admin.sessionId]);
    await logAdminAction(req.admin.username, 'ADMIN_LOGOUT', null, 'SUCCESS');
  }
  res.clearCookie('gowash_admin_session');
  res.json({ success: true });
});

// GET /api/admin/overview - Real database metrics
router.get('/overview', async (req, res) => {
  try {
    const totalSpinsRow = await db.get('SELECT COUNT(*) as count FROM spins');
    const uniqueParticipantsRow = await db.get('SELECT COUNT(DISTINCT participant_id) as count FROM spins');
    const rewardsIssuedRow = await db.get('SELECT COUNT(*) as count FROM promo_codes');
    const activeCodesRow = await db.get("SELECT COUNT(*) as count FROM promo_codes WHERE status = 'ACTIVE'");
    const redeemedCodesRow = await db.get("SELECT COUNT(*) as count FROM promo_codes WHERE status = 'REDEEMED'");
    const expiredCodesRow = await db.get("SELECT COUNT(*) as count FROM promo_codes WHERE status = 'EXPIRED'");
    const blockedRequestsRow = await db.get(`
      SELECT COUNT(*) as count FROM security_logs
      WHERE event_type IN ('RATE_LIMIT_EXCEEDED', 'SPIN_FLOOD_ATTEMPT', 'CONCURRENT_SPIN_BLOCKED')
    `);

    const campaign = await db.get('SELECT status, name, start_date, end_date FROM campaign_settings WHERE id = 1');

    res.json({
      success: true,
      stats: {
        totalSpins: parseInt(totalSpinsRow?.count || 0, 10),
        uniqueParticipants: parseInt(uniqueParticipantsRow?.count || 0, 10),
        rewardsIssued: parseInt(rewardsIssuedRow?.count || 0, 10),
        activeCodes: parseInt(activeCodesRow?.count || 0, 10),
        redeemedCodes: parseInt(redeemedCodesRow?.count || 0, 10),
        expiredCodes: parseInt(expiredCodesRow?.count || 0, 10),
        blockedRequests: parseInt(blockedRequestsRow?.count || 0, 10)
      },
      campaign: campaign || { status: 'ACTIVE' }
    });
  } catch (err) {
    console.error('Error fetching overview stats:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء تحميل الإحصائيات.' });
  }
});

// GET /api/admin/campaign
router.get('/campaign', async (req, res) => {
  const campaign = await db.get('SELECT * FROM campaign_settings WHERE id = 1');
  res.json({ success: true, campaign });
});

// PUT /api/admin/campaign
router.put('/campaign', validateCsrf, async (req, res) => {
  const { status, name, start_date, end_date, max_spins_per_participant } = req.body || {};

  if (!['ACTIVE', 'PAUSED', 'ENDED'].includes(status)) {
    return res.status(400).json({ success: false, error: 'حالة الفعالية غير صالحة. اختر بين ACTIVE أو PAUSED أو ENDED.' });
  }

  const now = new Date().toISOString();
  await db.run(`
    UPDATE campaign_settings
    SET status = ?, name = COALESCE(?, name), start_date = ?, end_date = ?,
        max_spins_per_participant = COALESCE(?, max_spins_per_participant), updated_at = ?
    WHERE id = 1
  `, [status, name || null, start_date || null, end_date || null, max_spins_per_participant || 1, now]);

  await logAdminAction(req.admin.username, 'CAMPAIGN_STATUS_UPDATED', status, 'SUCCESS', { name, start_date, end_date });

  res.json({ success: true, message: 'تم تحديث إعدادات الحملة بنجاح.' });
});

// POST /api/admin/kill-switch - Instant stop
router.post('/kill-switch', validateCsrf, async (req, res) => {
  const now = new Date().toISOString();
  await db.run("UPDATE campaign_settings SET status = 'PAUSED', updated_at = ? WHERE id = 1", [now]);
  await logAdminAction(req.admin.username, 'KILL_SWITCH_TRIGGERED', 'CAMPAIGN_PAUSED', 'SUCCESS', 'Emergency kill switch triggered');

  res.json({ success: true, message: 'تم تفعيل زر الإيقاف الفوري (Kill Switch). تم إيقاف الفعالية فورياً.' });
});

// GET /api/admin/prizes
router.get('/prizes', async (req, res) => {
  const prizes = await db.all('SELECT * FROM prizes ORDER BY display_order ASC');
  res.json({ success: true, prizes });
});

// PUT /api/admin/prizes - Strict probability validation (Must equal 100%)
router.put('/prizes', validateCsrf, async (req, res) => {
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
    await db.transaction(async (tx) => {
      for (const p of prizes) {
        await tx.run(`
          UPDATE prizes
          SET label = ?, subtext = ?, probability = ?, is_active = COALESCE(?, 1)
          WHERE id = ?
        `, [p.label, p.subtext, parseFloat(p.probability), p.is_active !== undefined ? p.is_active : 1, p.id]);
      }
    });

    await logAdminAction(req.admin.username, 'PROBABILITY_UPDATED', 'prizes', 'SUCCESS', { totalProbability });

    res.json({ success: true, message: 'تم تحديث نسب واحتمالات الجوائز بنجاح.' });
  } catch (err) {
    console.error('Error updating prizes:', err);
    res.status(500).json({ success: false, error: 'فشل حفظ تعديلات الجوائز.' });
  }
});

// GET /api/admin/spins - Search & pagination
router.get('/spins', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(10, parseInt(req.query.limit || '20', 10)));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  let query = `
    SELECT s.id, s.participant_id, s.created_at, pr.label as prize_label, pr.type as prize_type,
           p.code as promo_code, p.status as promo_status, p.expires_at, p.redeemed_at,
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

  const totalRow = await db.get(countQuery, params);
  const total = parseInt(totalRow?.count || 0, 10);
  const records = await db.all(query, [...params, limit, offset]);

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
router.get('/promos', async (req, res) => {
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

  const totalRow = await db.get(countQuery, params);
  const total = parseInt(totalRow?.count || 0, 10);
  const records = await db.all(query, [...params, limit, offset]);

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

// GET /api/admin/promos/lookup?term=...
router.get('/promos/lookup', async (req, res) => {
  const result = await lookupPromoCode(req.query.term);
  if (!result.success) {
    return res.status(404).json(result);
  }
  res.json(result);
});

// GET /api/admin/verify/:term - Quick Admin Verification Lookup (by Code or QR Token)
router.get('/verify/:term', async (req, res) => {
  try {
    const result = await verifyPromo(req.params.term);
    if (!result.success) {
      const status = result.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('Error in admin verify lookup:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء فحص الجائزة.' });
  }
});

// GET /api/admin/backup/export - Authenticated database backup download
router.get('/backup/export', async (req, res) => {
  try {
    const summary = await createBackup();
    await logAdminAction(req.admin.username, 'DB_BACKUP_EXPORT', summary.filename, 'SUCCESS');
    res.download(summary.file, summary.filename);
  } catch (err) {
    console.error('Error exporting database backup:', err);
    res.status(500).json({ success: false, error: 'فشل تصدير النسخة الاحتياطية.' });
  }
});

// POST /api/admin/promos/:code/redeem
router.post('/promos/:code/redeem', validateCsrf, async (req, res) => {
  const verification = req.body?.participantVerification || req.body?.participantPhone || req.body?.phone || null;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const result = await redeemPromoCode(req.params.code, req.admin.username, verification, ip);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/admin/promos/:code/unredeem
router.post('/promos/:code/unredeem', validateCsrf, async (req, res) => {
  const result = await unredeemPromoCode(req.params.code, req.admin.username);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/admin/promos/:code/cancel
router.post('/promos/:code/cancel', validateCsrf, async (req, res) => {
  const result = await cancelPromoCode(req.params.code, req.admin.username, req.body?.reason);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// GET /api/admin/redemptions - List dedicated redemption logs
router.get('/redemptions', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(10, parseInt(req.query.limit || '20', 10)));
  const offset = (page - 1) * limit;

  const totalRow = await db.get('SELECT COUNT(*) as count FROM redemptions');
  const total = parseInt(totalRow?.count || 0, 10);
  const records = await db.all('SELECT * FROM redemptions ORDER BY redeemed_at DESC LIMIT ? OFFSET ?', [limit, offset]);

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

// GET /api/admin/security-logs
router.get('/security-logs', async (req, res) => {
  const logs = await db.all('SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 50');
  res.json({ success: true, logs });
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req, res) => {
  const logs = await db.all('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50');
  res.json({ success: true, logs });
});

// PUT /api/admin/password
router.put('/password', validateCsrf, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم كلمة المرور الحالية والجديدة.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'يجب أن لا تقل كلمة المرور الجديدة عن 8 أحرف.' });
  }

  const user = await db.get('SELECT password_hash FROM admin_users WHERE id = ?', [req.admin.id]);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ success: false, error: 'كلمة المرور الحالية غير صحيحة.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const newHash = bcrypt.hashSync(newPassword, salt);

  await db.run('UPDATE admin_users SET password_hash = ? WHERE id = ?', [newHash, req.admin.id]);
  await logAdminAction(req.admin.username, 'PASSWORD_CHANGED', null, 'SUCCESS');

  res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح.' });
});

module.exports = router;
