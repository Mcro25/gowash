const express = require('express');
const router = express.Router();
const db = require('../db');
const { executeSpin, checkPrizeByPhone } = require('../services/spinService');
const { spinRateLimiter } = require('../middleware/rateLimiter');

// GET /api/campaign - Public campaign metadata for client
router.get('/campaign', (req, res) => {
  try {
    const campaign = db.prepare(`
      SELECT status, name, start_date, end_date, max_spins_per_participant
      FROM campaign_settings
      WHERE id = 1
    `).get();

    // Visual sectors order - DO NOT EXPOSE PROBABILITY
    const prizes = db.prepare(`
      SELECT id, label, type, subtext, color, text_color, display_order
      FROM prizes
      WHERE is_active = 1
      ORDER BY display_order ASC
    `).all();

    // Check if current participant already spun
    let hasSpun = false;
    let existingResult = null;

    if (req.participantId) {
      const spin = db.prepare(`
        SELECT s.id, pr.label as prize_label, pr.type as prize_type, pr.subtext as prize_subtext,
               p.code as promo_code, p.expires_at as promo_expires_at, p.status as promo_status
        FROM spins s
        JOIN prizes pr ON s.prize_id = pr.id
        LEFT JOIN promo_codes p ON s.id = p.spin_id
        WHERE s.participant_id = ?
      `).get(req.participantId);

      if (spin) {
        hasSpun = true;
        existingResult = {
          label: spin.prize_label,
          type: spin.prize_type,
          subtext: spin.prize_subtext,
          code: spin.promo_code,
          expiresAt: spin.promo_expires_at,
          status: spin.promo_status
        };
      }
    }

    res.json({
      success: true,
      campaign: {
        status: campaign ? campaign.status : 'ACTIVE',
        name: campaign ? campaign.name : 'Go Wash Saudi National Day 96',
        termsVersion: require('../config').CURRENT_TERMS_VERSION,
        socialLinks: require('../config').SOCIAL_LINKS,
        offers: {
          twoCars: {
            title: 'غسيل سيارتين في نفس الموقع',
            discount: 25,
            stackable: false,
            note: 'العرض مستقل تماماً وغير قابل للجمع مع خصومات Spin Wheel أو أي عروض ترويجية أخرى.'
          }
        }
      },
      prizes, // strictly sanitized
      participant: {
        hasSpun,
        existingResult
      }
    });
  } catch (err) {
    console.error('Error fetching campaign metadata:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء تحميل بيانات الفعالية.' });
  }
});

// POST /api/spin - Atomic spin endpoint
router.post('/spin', spinRateLimiter(30, 60000), (req, res) => {
  try {
    const participantId = req.participantId;
    if (!participantId) {
      return res.status(400).json({ success: false, error: 'تعذر التحقق من معرف الجلسة. يرجى تحديث الصفحة.' });
    }

    const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';
    const termsAccepted = req.body?.termsAccepted;
    const termsVersion = req.body?.termsVersion;
    const name = req.body?.name;
    const phone = req.body?.phone;

    const result = executeSpin({
      participantId,
      idempotencyKey,
      ip,
      userAgent,
      termsAccepted,
      termsVersion,
      name,
      phone
    });

    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'ALREADY_SPUN') statusCode = 403;
      else if (result.code === 'SERVER_ERROR') statusCode = 500;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('Unexpected spin endpoint error:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.' });
  }
});

// POST /api/check-prize - Lookup and restore participant's prize by phone number
router.post('/check-prize', spinRateLimiter(20, 60000), (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال رقم الجوال.' });
    }
    const result = checkPrizeByPhone(phone);
    if (!result.success) {
      const code = result.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('Error in check-prize:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء البحث عن الجائزة.' });
  }
});

module.exports = router;
