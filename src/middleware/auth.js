const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { hashIp } = require('./rateLimiter');

// Middleware to identify campaign participant securely
async function participantIdentifier(req, res, next) {
  try {
    let pid = req.headers['x-participant-id'] || (req.cookies ? req.cookies.gowash_pid : null);
    const isValidUuid = typeof pid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);

    if (!isValidUuid) {
      pid = crypto.randomUUID();
    }

    const isSecure = config.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';

    // Set cookie with cross-origin compatibility (SameSite=None; Secure for GitHub Pages -> Railway)
    res.cookie('gowash_pid', pid, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'None' : 'Lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/'
    });

    // Also expose as header for resilient client-side storage
    res.setHeader('X-Participant-Id', pid);

    // Ensure record exists in DB
    const existing = await db.get('SELECT id FROM participants WHERE id = ?', [pid]);
    if (!existing) {
      const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
      const userAgent = (req.headers['user-agent'] || '').substring(0, 255);
      try {
        await db.run(`
          INSERT INTO participants (id, first_seen_at, ip_hash, user_agent)
          VALUES (?, ?, ?, ?)
        `, [pid, new Date().toISOString(), hashIp(ip), userAgent]);
      } catch (e) {
        // Ignore conflict if inserted in parallel
      }
    }

    req.participantId = pid;
    next();
  } catch (err) {
    console.error('Participant identifier error:', err);
    next();
  }
}

// Middleware to authenticate admin session
async function requireAdmin(req, res, next) {
  try {
    const sessionId = req.cookies ? req.cookies.gowash_admin_session : null;
    const isApi = (req.originalUrl && req.originalUrl.startsWith('/api/')) ||
                  (req.baseUrl && req.baseUrl.startsWith('/api/')) ||
                  (req.path && req.path.startsWith('/api/')) ||
                  (req.headers.accept && req.headers.accept.includes('application/json'));

    if (!sessionId) {
      if (isApi) {
        return res.status(401).json({ success: false, error: 'جلسة الإدارة غير صالحة. يرجى تسجيل الدخول.' });
      }
      return res.redirect('/admin/login.html');
    }

    const now = new Date().toISOString();
    const session = await db.get(`
      SELECT s.id, s.admin_id, s.csrf_token, s.expires_at, u.username, u.email
      FROM admin_sessions s
      JOIN admin_users u ON s.admin_id = u.id
      WHERE s.id = ? AND s.expires_at > ?
    `, [sessionId, now]);

    if (!session) {
      res.clearCookie('gowash_admin_session');
      if (isApi) {
        return res.status(401).json({ success: false, error: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.' });
      }
      return res.redirect('/admin/login.html');
    }

    req.admin = {
      sessionId: session.id,
      id: session.admin_id,
      username: session.username,
      email: session.email,
      csrfToken: session.csrf_token
    };

    next();
  } catch (err) {
    console.error('Admin authentication error:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء التحقق من الجلسة.' });
  }
}

// CSRF validation for admin state changes
async function validateCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const clientToken = req.headers['x-csrf-token'];
  if (!clientToken || !req.admin || clientToken !== req.admin.csrfToken) {
    try {
      const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
      await db.run(`
        INSERT INTO security_logs (timestamp, ip_hash, participant_id, event_type, details)
        VALUES (?, ?, ?, 'CSRF_FAILED', ?)
      `, [new Date().toISOString(), hashIp(ip), null, `CSRF mismatch for admin: ${req.admin ? req.admin.username : 'unknown'}`]);
    } catch (e) {}

    return res.status(403).json({ success: false, error: 'رمز الحماية CSRF غير صالح أو منتهي الصلاحية.' });
  }

  next();
}

module.exports = {
  participantIdentifier,
  requireAdmin,
  validateCsrf
};
