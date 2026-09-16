const fs = require('fs');
const path = require('path');

// Simple zero-dependency .env loader
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const val = trimmed.slice(eqIndex + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  SESSION_SECRET: process.env.SESSION_SECRET || 'gowash_nd96_default_secret_2026',
  CSRF_SECRET: process.env.CSRF_SECRET || 'gowash_nd96_default_csrf_2026',
  ADMIN_INITIAL_USERNAME: process.env.ADMIN_INITIAL_USERNAME || 'admin',
  ADMIN_INITIAL_EMAIL: process.env.ADMIN_INITIAL_EMAIL || 'admin@gowash.sa',
  ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD || 'GoWash96@Admin',
  CAMPAIGN_TIMEZONE: process.env.CAMPAIGN_TIMEZONE || 'Asia/Riyadh',
  SESSION_EXPIRY_MS: 12 * 60 * 60 * 1000, // 12 hours
  PROMO_EXPIRY_HOURS: 48, // 48 hours for promo codes
};
