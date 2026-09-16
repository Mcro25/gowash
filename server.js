const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./src/config');
const securityHeaders = require('./src/middleware/securityHeaders');
const { participantIdentifier, requireAdmin } = require('./src/middleware/auth');
const { apiRateLimiter } = require('./src/middleware/rateLimiter');
const apiRoutes = require('./src/routes/api');
const adminApiRoutes = require('./src/routes/adminApi');

const app = express();

// Trust proxy for IP rate-limiting behind reverse proxy / hosting platforms
app.set('trust proxy', 1);

// Core Middlewares
app.use(securityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// Rate limit general API
app.use('/api', apiRateLimiter(80, 60000));

// Participant identification for public endpoints & home
app.use(participantIdentifier);

// Customer API
app.use('/api', apiRoutes);

// Protected Admin API
app.use('/api/admin', adminApiRoutes);

// Admin dashboard route protection
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: config.NODE_ENV === 'production' ? '1h' : '0',
  index: 'index.html'
}));

// Fallback 404 handler for API
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'نقطة النهاية المطلوبة غير موجودة.' });
});

// Centralized error handling
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  if (res.headersSent) {
    return next(err);
  }
  if (req.path.startsWith('/api')) {
    return res.status(500).json({
      success: false,
      error: 'حدث خطأ. حاول مرة أخرى.'
    });
  }
  res.status(500).send('حدث خطأ في الخادم. يرجى المحاولة لاحقاً.');
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`=========================================`);
    console.log(`Go Wash Saudi National Day 96 Event App`);
    console.log(`Running on: http://localhost:${config.PORT}`);
    console.log(`Customer Page: http://localhost:${config.PORT}/`);
    console.log(`Admin Dashboard: http://localhost:${config.PORT}/admin`);
    console.log(`Environment: ${config.NODE_ENV}`);
    console.log(`=========================================`);
  });
}

module.exports = app;
