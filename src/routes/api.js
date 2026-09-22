const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const { executeSpin, checkPrizeByPhone, getMyResult, recordConsent, handleParticipantEntry, parseSaudiPhone } = require('../services/spinService');
const { verifyPromo } = require('../services/promoService');
const { logSecurityEvent } = require('../services/auditService');
const { hashIp, spinRateLimiter, consentRateLimiter, redeemRateLimiter, entryRateLimiter } = require('../middleware/rateLimiter');

// GET /api/campaign - Public campaign metadata & visual sector layout
router.get('/campaign', async (req, res) => {
  try {
    const campaign = await db.get(`
      SELECT status, name, start_date, end_date, max_spins_per_participant
      FROM campaign_settings
      WHERE id = 1
    `);

    // Visual sectors order - STRICTLY SANITIZED: DO NOT EXPOSE PROBABILITY OR WEIGHTS
    const prizes = await db.all(`
      SELECT id, label, type, subtext, color, text_color, display_order
      FROM prizes
      WHERE is_active = 1
      ORDER BY display_order ASC
    `);

    // Check if current participant already spun
    let hasSpun = false;
    let existingResult = null;

    if (req.participantId) {
      const myRes = await getMyResult(req.participantId);
      if (myRes.status !== 'NO_SPIN') {
        hasSpun = true;
        existingResult = {
          spinId: myRes.spinId || myRes.prize?.id,
          prizeId: myRes.prize?.id,
          label: myRes.prize?.label,
          type: myRes.prize?.type,
          subtext: myRes.prize?.subtext,
          code: myRes.promo?.code,
          promoCode: myRes.promo?.code,
          expiresAt: myRes.promo?.expiresAt,
          redeemedAt: myRes.promo?.redeemedAt,
          createdAt: myRes.promo?.createdAt || new Date().toISOString(),
          status: myRes.status,
          participant: {
            name: myRes.participant?.name,
            phone: myRes.participant?.phone
          },
          name: myRes.participant?.name,
          phone: myRes.participant?.phone
        };
      }
    }

    res.json({
      success: true,
      participantId: req.participantId,
      campaign: {
        status: campaign ? campaign.status : 'ACTIVE',
        name: campaign ? campaign.name : 'Go Wash Saudi National Day 96',
        termsVersion: config.CURRENT_TERMS_VERSION,
        socialLinks: config.SOCIAL_LINKS,
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
      },
      hasSpun,
      existingResult
    });
  } catch (err) {
    console.error('Error fetching campaign metadata:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء تحميل بيانات الفعالية.' });
  }
});

// POST /api/participant/entry & /api/participant - Event Entry Screen upfront registration & duplicate check
router.post(['/participant/entry', '/participant'], entryRateLimiter(25, 60000), async (req, res) => {
  try {
    const participantId = req.participantId;
    if (!participantId) {
      return res.status(400).json({ success: false, error: 'تعذر التحقق من معرف الجلسة. يرجى تحديث الصفحة.' });
    }

    const { name, phone } = req.body || {};
    const result = await handleParticipantEntry({
      participantId,
      name,
      phone,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent') || ''
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('Participant entry error:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ غير متوقع أثناء تسجيل الدخول.' });
  }
});

// POST /api/participant/send-otp (Optional OTP capability)
router.post('/participant/send-otp', entryRateLimiter(5, 60000), async (req, res) => {
  if (!config.ENABLE_OTP) {
    return res.status(404).json({ success: false, error: 'خدمة التحقق عبر الرسائل النصية غير مفعلة حالياً.' });
  }
  const { phone } = req.body || {};
  const parsed = parseSaudiPhone(phone);
  if (!parsed) {
    return res.status(400).json({ success: false, error: 'رقم الجوال غير صحيح.' });
  }
  const otpCode = String(Math.floor(1000 + Math.random() * 9000));
  const expiresAt = new Date(Date.now() + 5 * 60000).toISOString();
  await db.run('UPDATE participants SET otp_code = ?, otp_expires_at = ? WHERE id = ?', [otpCode, expiresAt, req.participantId]);
  res.json({ success: true, message: 'تم إرسال رمز التحقق إلى جوالك.' });
});

// POST /api/participant/verify-otp (Optional OTP verification)
router.post('/participant/verify-otp', entryRateLimiter(10, 60000), async (req, res) => {
  if (!config.ENABLE_OTP) {
    return res.status(404).json({ success: false, error: 'خدمة التحقق غير مفعلة.' });
  }
  const { otp } = req.body || {};
  const row = await db.get('SELECT otp_code, otp_expires_at FROM participants WHERE id = ?', [req.participantId]);
  if (!row || row.otp_code !== otp || new Date(row.otp_expires_at) < new Date()) {
    return res.status(400).json({ success: false, error: 'رمز التحقق غير صحيح أو انتهت صلاحيته.' });
  }
  await db.run('UPDATE participants SET otp_verified = 1, otp_code = NULL WHERE id = ?', [req.participantId]);
  res.json({ success: true, message: 'تم التحقق بنجاح.' });
});

// POST /api/consent & POST /api/campaign/consent - Record participant terms agreement before spin
router.post(['/consent', '/campaign/consent'], consentRateLimiter(15, 60000), async (req, res) => {
  try {
    const participantId = req.participantId;
    if (!participantId) {
      return res.status(400).json({ success: false, error: 'تعذر التحقق من معرف الجلسة. يرجى تحديث الصفحة.' });
    }

    const { termsAccepted, termsVersion } = req.body || {};
    if (!termsAccepted) {
      return res.status(400).json({ success: false, error: 'يجب الموافقة على الشروط والأحكام للمشاركة.' });
    }

    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const result = await recordConsent({
      participantId,
      campaignId: 'national_day_96',
      termsVersion: termsVersion || config.CURRENT_TERMS_VERSION,
      ip
    });

    res.json(result);
  } catch (err) {
    console.error('Consent recording error:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء تسجيل الموافقة على الشروط.' });
  }
});

// POST /api/redeem-request - Public Redemption request / verification
router.post('/redeem-request', redeemRateLimiter(15, 60000), async (req, res) => {
  try {
    const code = (req.body?.code || req.body?.promoCode || '').trim();
    const phone = (req.body?.phone || req.body?.mobile || '').trim();

    if (!code) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', error: 'يرجى إدخال الكود الترويجي.' });
    }

    const verification = await verifyPromo(code);
    if (!verification.success) {
      return res.status(verification.code === 'NOT_FOUND' ? 404 : 400).json(verification);
    }

    // Single-Person Phone Ownership Verification if phone provided
    if (phone) {
      const { normalizeSaudiPhone } = require('../services/spinService');
      const cleanInput = normalizeSaudiPhone(phone);
      const promoPhone = normalizeSaudiPhone(verification.participant?.phone);

      if (cleanInput && promoPhone && cleanInput !== promoPhone) {
        return res.status(400).json({
          success: false,
          code: 'PARTICIPANT_MISMATCH',
          error: 'فشل التحقق الأمني: رقم الجوال لا يتطابق مع صاحب الكود المسجل.'
        });
      }
    }

    if (verification.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        code: verification.status,
        error: verification.statusLabel
      });
    }

    res.json({
      success: true,
      valid: true,
      message: 'طلب الاسترداد صالح. يرجى تأكيد الحجز لدى ممثل خدمة Go Wash.',
      promo: {
        code: verification.code,
        prize: verification.prize,
        expiresAt: verification.dates.expiresAt,
        status: verification.status
      },
      participant: {
        name: verification.participant?.name
      }
    });
  } catch (err) {
    console.error('Redeem request error:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء معالجة طلب الاسترداد.' });
  }
});

// GET /api/my-result - Query participant state from PostgreSQL (NO_SPIN, ALREADY_SPUN, REDEEMED, EXPIRED)
router.get('/my-result', async (req, res) => {
  try {
    const participantId = req.participantId;
    if (!participantId) {
      return res.json({ success: true, status: 'NO_SPIN' });
    }

    const result = await getMyResult(participantId);
    res.json(result);
  } catch (err) {
    console.error('Error in my-result:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء جلب نتيجة الفعالية.' });
  }
});

// POST /api/share-event - Telemetry for social sharing (WhatsApp, Instagram, TikTok, etc.)
router.post('/share-event', async (req, res) => {
  try {
    const { channel, promoCode } = req.body || {};
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    await logSecurityEvent(hashIp(ip), req.participantId || null, 'SOCIAL_SHARE', {
      channel: channel || 'unknown',
      promoCode: promoCode || null
    });
    res.json({ success: true, message: 'تم تسجيل المشاركة بنجاح.' });
  } catch (err) {
    res.json({ success: true }); // Share logging failure shouldn't block client
  }
});

// POST /api/spin - Atomic spin endpoint
router.post('/spin', spinRateLimiter(30, 60000), async (req, res) => {
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

    const result = await executeSpin({
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
router.post('/check-prize', spinRateLimiter(20, 60000), async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال رقم الجوال.' });
    }
    const result = await checkPrizeByPhone(phone);
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

// GET /api/verify/:token - Public Prize Verification (Safe, Sanitized, Server-side truth)
router.get('/verify/:token', async (req, res) => {
  try {
    const result = await verifyPromo(req.params.token);
    if (!result.success) {
      const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(statusCode).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('Error verifying prize token:', err);
    res.status(500).json({ success: false, error: 'حدث خطأ أثناء التحقق من الجائزة.' });
  }
});

// GET /api/qr/:token - Dynamic QR Code Image (PNG)
router.get('/qr/:token', async (req, res) => {
  try {
    const token = req.params.token;
    if (!token) {
      return res.status(400).send('Token required');
    }

    const promo = await db.get(
      'SELECT id FROM promo_codes WHERE qr_token = ? OR code = ?',
      [token.trim(), token.trim().toUpperCase()]
    );
    if (!promo) {
      return res.status(404).send('رمز التحقق أو الكود غير موجود');
    }

    const verifyUrl = `${req.protocol}://${req.get('host')}/verify/${token}`;
    const qrBuffer = await QRCode.toBuffer(verifyUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: {
        dark: '#002B49',
        light: '#FFFFFF'
      }
    });
    res.type('png').send(qrBuffer);
  } catch (err) {
    console.error('Error generating QR image:', err);
    res.status(500).send('QR generation error');
  }
});

module.exports = router;
