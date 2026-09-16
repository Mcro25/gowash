const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const config = require('./config');

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'gowash.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode & foreign keys
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_settings (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      max_spins_per_participant INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prizes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      subtext TEXT NOT NULL,
      probability REAL NOT NULL,
      color TEXT NOT NULL,
      text_color TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      ip_hash TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS spins (
      id TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL,
      prize_id TEXT NOT NULL,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      ip_hash TEXT,
      FOREIGN KEY (participant_id) REFERENCES participants(id),
      FOREIGN KEY (prize_id) REFERENCES prizes(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_spins_participant ON spins(participant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_spins_idempotency ON spins(participant_id, idempotency_key);

    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      spin_id TEXT NOT NULL,
      prize_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      redeemed_at TEXT,
      FOREIGN KEY (spin_id) REFERENCES spins(id),
      FOREIGN KEY (prize_id) REFERENCES prizes(id),
      FOREIGN KEY (participant_id) REFERENCES participants(id)
    );

    CREATE INDEX IF NOT EXISTS idx_promos_code ON promo_codes(code);
    CREATE INDEX IF NOT EXISTS idx_promos_status ON promo_codes(status);

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      admin_user TEXT,
      action TEXT NOT NULL,
      target TEXT,
      result TEXT,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      ip_hash TEXT,
      participant_id TEXT,
      event_type TEXT NOT NULL,
      details TEXT
    );
  `);

  // Seed default campaign settings if empty
  const campaign = db.prepare('SELECT id FROM campaign_settings WHERE id = 1').get();
  if (!campaign) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO campaign_settings (id, status, name, start_date, end_date, max_spins_per_participant, updated_at)
      VALUES (1, 'ACTIVE', 'Go Wash Saudi National Day 96 Exclusive', '2026-09-15T00:00:00Z', '2026-09-30T23:59:59Z', 1, ?)
    `).run(now);
  }

  // Seed default prizes if empty
  const prizeCount = db.prepare('SELECT COUNT(*) as count FROM prizes').get();
  if (prizeCount.count === 0) {
    const initialPrizes = [
      {
        id: 'discount_20',
        label: '20%',
        type: 'discount',
        amount: 20,
        subtext: 'خصم على غسيل Go Wash بمناسبة اليوم الوطني',
        probability: 15.0,
        color: '#1D6FB8',
        text_color: '#FFFFFF',
        display_order: 0
      },
      {
        id: 'discount_15',
        label: '15%',
        type: 'discount',
        amount: 15,
        subtext: 'خصم على غسيل سيارتك المتنقل',
        probability: 25.0,
        color: '#006C35',
        text_color: '#FFFFFF',
        display_order: 1
      },
      {
        id: 'discount_10',
        label: '10%',
        type: 'discount',
        amount: 10,
        subtext: 'خصم فوري لاحتفال اليوم الوطني 96',
        probability: 30.0,
        color: '#0F2A4A',
        text_color: '#FFFFFF',
        display_order: 2
      },
      {
        id: 'discount_9_6',
        label: '9.6%',
        type: 'discount',
        amount: 9.6,
        subtext: 'خصم رمزي خاص باليوم الوطني 96',
        probability: 19.0,
        color: '#005429',
        text_color: '#72F3AA',
        display_order: 3
      },
      {
        id: 'discount_5',
        label: '5%',
        type: 'discount',
        amount: 5,
        subtext: 'خصم على خدمات غسيل Go Wash',
        probability: 10.0,
        color: '#14375A',
        text_color: '#FFFFFF',
        display_order: 4
      },
      {
        id: 'signature_upgrade',
        label: 'Signature',
        type: 'upgrade',
        amount: 100,
        subtext: 'ادفع قيمة الغسيل العادي واحصل على GoWash Signature',
        probability: 1.0,
        color: '#F15A24',
        text_color: '#FFFFFF',
        display_order: 5
      }
    ];

    const insertPrize = db.prepare(`
      INSERT INTO prizes (id, label, type, amount, subtext, probability, color, text_color, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    for (const p of initialPrizes) {
      insertPrize.run(p.id, p.label, p.type, p.amount, p.subtext, p.probability, p.color, p.text_color, p.display_order);
    }
  }

  // Seed default admin user if none exists
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
  if (adminCount.count === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(config.ADMIN_INITIAL_PASSWORD, salt);
    const adminId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO admin_users (id, username, email, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(adminId, config.ADMIN_INITIAL_USERNAME, config.ADMIN_INITIAL_EMAIL, hash, now);
  }
}

initSchema();

module.exports = db;
