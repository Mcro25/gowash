const db = require('../db');

function logAdminAction(adminUser, action, target = null, result = 'SUCCESS', details = null) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (timestamp, admin_user, action, target, result, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      adminUser || 'system',
      action,
      target ? String(target) : null,
      result,
      details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : null
    );
  } catch (err) {
    console.error('Failed to log admin action:', err);
  }
}

function logSecurityEvent(ipHash, participantId, eventType, details = null) {
  try {
    db.prepare(`
      INSERT INTO security_logs (timestamp, ip_hash, participant_id, event_type, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      ipHash || null,
      participantId || null,
      eventType,
      details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : null
    );
  } catch (err) {
    console.error('Failed to log security event:', err);
  }
}

module.exports = {
  logAdminAction,
  logSecurityEvent
};
