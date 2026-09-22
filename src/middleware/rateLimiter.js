const crypto = require('node:crypto');

// In-memory sliding window rate limiter
const ipWindows = new Map();
const spinWindows = new Map();

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip || 'unknown').digest('hex').substring(0, 16);
}

const loginWindows = new Map();
const consentWindows = new Map();
const redeemWindows = new Map();

// Clean up stale entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of ipWindows.entries()) {
    if (now - record.startTime > 60000) ipWindows.delete(key);
  }
  for (const [key, record] of spinWindows.entries()) {
    if (now - record.startTime > 600000) spinWindows.delete(key);
  }
  for (const [key, record] of loginWindows.entries()) {
    if (now - record.startTime > 900000) loginWindows.delete(key);
  }
  for (const [key, record] of consentWindows.entries()) {
    if (now - record.startTime > 60000) consentWindows.delete(key);
  }
  for (const [key, record] of redeemWindows.entries()) {
    if (now - record.startTime > 60000) redeemWindows.delete(key);
  }
}, 300000);
if (cleanupTimer.unref) cleanupTimer.unref();

function apiRateLimiter(maxRequests = 60, windowMs = 60000) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = hashIp(ip);
    const now = Date.now();

    let record = ipWindows.get(key);
    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now };
      ipWindows.set(key, record);
    } else {
      record.count++;
    }

    if (record.count > maxRequests) {
      try {
        const db = require('../db');
        db.run(`
          INSERT INTO security_logs (timestamp, ip_hash, participant_id, event_type, details)
          VALUES (?, ?, ?, 'RATE_LIMIT_EXCEEDED', ?)
        `, [new Date().toISOString(), key, req.participantId || null, `Exceeded general API limit: ${record.count} reqs`]);
      } catch (e) {}

      res.set('Retry-After', Math.ceil((windowMs - (now - record.startTime)) / 1000));
      return res.status(429).json({
        success: false,
        error: 'تجاوزت الحد المسموح من الطلبات المؤقتة. يرجى المحاولة بعد قليل.'
      });
    }

    next();
  };
}

function spinRateLimiter(maxSpins = 5, windowMs = 60000) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = hashIp(ip);
    const now = Date.now();

    let record = spinWindows.get(key);
    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now };
      spinWindows.set(key, record);
    } else {
      record.count++;
    }

    if (record.count > maxSpins) {
      try {
        const db = require('../db');
        db.run(`
          INSERT INTO security_logs (timestamp, ip_hash, participant_id, event_type, details)
          VALUES (?, ?, ?, 'SPIN_FLOOD_ATTEMPT', ?)
        `, [new Date().toISOString(), key, req.participantId || null, `Exceeded spin attempt threshold: ${record.count} attempts`]);
      } catch (e) {}

      return res.status(429).json({
        success: false,
        error: 'تم رصد محاولات دوران متعددة وسريعة. يرجى الانتظار دقيقة قبل المحاولة مجدداً.'
      });
    }

    next();
  };
}

function loginRateLimiter(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = hashIp(ip);
    const now = Date.now();

    let record = loginWindows.get(key);
    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now };
      loginWindows.set(key, record);
    } else {
      record.count++;
    }

    if (record.count > maxAttempts) {
      try {
        const db = require('../db');
        db.run(`
          INSERT INTO security_logs (timestamp, ip_hash, participant_id, event_type, details)
          VALUES (?, ?, ?, 'LOGIN_BRUTE_FORCE_ATTEMPT', ?)
        `, [new Date().toISOString(), key, null, `Exceeded login limit: ${record.count} attempts from ${key}`]);
      } catch (e) {}

      res.set('Retry-After', Math.ceil((windowMs - (now - record.startTime)) / 1000));
      return res.status(429).json({
        success: false,
        error: 'تم تجاوز الحد الأقصى لمحاولات تسجيل الدخول. يرجى الانتظار 15 دقيقة قبل المحاولة مجدداً.'
      });
    }

    next();
  };
}

function consentRateLimiter(maxRequests = 15, windowMs = 60000) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = hashIp(ip);
    const now = Date.now();

    let record = consentWindows.get(key);
    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now };
      consentWindows.set(key, record);
    } else {
      record.count++;
    }

    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'تم تجاوز الحد المسموح لتسجيل الموافقة. يرجى الانتظار دقيقة.'
      });
    }

    next();
  };
}

function redeemRateLimiter(maxRequests = 15, windowMs = 60000) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = hashIp(ip);
    const now = Date.now();

    let record = redeemWindows.get(key);
    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now };
      redeemWindows.set(key, record);
    } else {
      record.count++;
    }

    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'تم تجاوز الحد المسموح لطلبات الاسترداد. يرجى الانتظار دقيقة.'
      });
    }

    next();
  };
}

function entryRateLimiter(maxRequests = 20, windowMs = 60000) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = hashIp(ip);
    const now = Date.now();

    let record = consentWindows.get('entry_' + key);
    if (!record || (now - record.startTime > windowMs)) {
      record = { count: 1, startTime: now };
      consentWindows.set('entry_' + key, record);
    } else {
      record.count++;
    }

    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'تم تجاوز الحد المسموح لمحاولات الدخول. يرجى الانتظار دقيقة.'
      });
    }

    next();
  };
}

module.exports = {
  apiRateLimiter,
  spinRateLimiter,
  loginRateLimiter,
  consentRateLimiter,
  entryRateLimiter,
  redeemRateLimiter,
  hashIp
};
