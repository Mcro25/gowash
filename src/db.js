const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');

let isPg = false;
let pgPool = null;
let sqliteDb = null;

// Determine DB Engine: PostgreSQL (Railway) vs SQLite (Local dev/test)
if (config.DATABASE_URL && config.DATABASE_URL.startsWith('postgres')) {
  isPg = true;
  const { Pool } = require('pg');
  const poolConfig = {
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  // Enable SSL for external hosting platforms (like Railway)
  if (!config.DATABASE_URL.includes('localhost') && !config.DATABASE_URL.includes('127.0.0.1')) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  pgPool = new Pool(poolConfig);
  pgPool.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]', err);
  });
} else {
  // SQLite Fallback for zero-dependency local dev/tests
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = process.env.DB_PATH || path.join(dataDir, 'gowash.db');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
}

// Convert SQLite style '?' placeholders to PostgreSQL style '$1, $2, ...'
function toPgQuery(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

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

// Unified DB Interface
const db = {
  isPg,

  async query(sql, params = []) {
    if (isPg) {
      const res = await pgPool.query(toPgQuery(sql), params);
      return res.rows;
    } else {
      const stmt = sqliteDb.prepare(sql);
      return stmt.all(...params);
    }
  },

  async get(sql, params = []) {
    if (isPg) {
      const res = await pgPool.query(toPgQuery(sql), params);
      return res.rows[0] || null;
    } else {
      const stmt = sqliteDb.prepare(sql);
      return stmt.get(...params) || null;
    }
  },

  async all(sql, params = []) {
    return this.query(sql, params);
  },

  async run(sql, params = []) {
    if (isPg) {
      const res = await pgPool.query(toPgQuery(sql), params);
      return { rowCount: res.rowCount };
    } else {
      const stmt = sqliteDb.prepare(sql);
      return stmt.run(...params);
    }
  },

  async exec(sql) {
    if (isPg) {
      return await pgPool.query(sql);
    } else {
      return sqliteDb.exec(sql);
    }
  },

  // Prepare emulation for SQLite synchronous legacy code if needed
  prepare(sql) {
    if (!isPg && sqliteDb) {
      return sqliteDb.prepare(sql);
    }
    // If on PG, return a promise-like wrapper
    return {
      get: (...params) => this.get(sql, params),
      all: (...params) => this.all(sql, params),
      run: (...params) => this.run(sql, params)
    };
  },

  // Atomic transaction runner
  async transaction(fn) {
    if (isPg) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const txHelper = {
          async get(sql, params = []) {
            const res = await client.query(toPgQuery(sql), params);
            return res.rows[0] || null;
          },
          async all(sql, params = []) {
            const res = await client.query(toPgQuery(sql), params);
            return res.rows;
          },
          async run(sql, params = []) {
            const res = await client.query(toPgQuery(sql), params);
            return { rowCount: res.rowCount };
          },
          async exec(sql) {
            return await client.query(sql);
          }
        };
        const result = await fn(txHelper);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      sqliteDb.exec('BEGIN IMMEDIATE');
      try {
        const txHelper = {
          async get(sql, params = []) {
            return sqliteDb.prepare(sql).get(...params) || null;
          },
          async all(sql, params = []) {
            return sqliteDb.prepare(sql).all(...params);
          },
          async run(sql, params = []) {
            return sqliteDb.prepare(sql).run(...params);
          },
          async exec(sql) {
            return sqliteDb.exec(sql);
          }
        };
        const result = await fn(txHelper);
        sqliteDb.exec('COMMIT');
        return result;
      } catch (err) {
        try { sqliteDb.exec('ROLLBACK'); } catch (e) {}
        throw err;
      }
    }
  }
};

// Initialize schema across PostgreSQL or SQLite
async function initSchema() {
  if (isPg) {
    // PostgreSQL DDL
    await db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_settings (
        id INTEGER PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        name VARCHAR(255) NOT NULL,
        start_date VARCHAR(64),
        end_date VARCHAR(64),
        max_spins_per_participant INTEGER NOT NULL DEFAULT 1,
        updated_at VARCHAR(64) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prizes (
        id VARCHAR(64) PRIMARY KEY,
        label VARCHAR(64) NOT NULL,
        type VARCHAR(64) NOT NULL,
        amount NUMERIC NOT NULL,
        subtext TEXT NOT NULL,
        probability NUMERIC NOT NULL,
        color VARCHAR(32) NOT NULL,
        text_color VARCHAR(32) NOT NULL,
        display_order INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS participants (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128),
        phone VARCHAR(32),
        normalized_phone VARCHAR(32),
        campaign_id VARCHAR(64) NOT NULL DEFAULT 'national_day_96',
        first_seen_at VARCHAR(64) NOT NULL,
        last_seen_at VARCHAR(64),
        otp_code VARCHAR(16),
        otp_expires_at VARCHAR(64),
        otp_verified INTEGER NOT NULL DEFAULT 0,
        ip_hash VARCHAR(64),
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_participants_phone ON participants(phone);

      CREATE TABLE IF NOT EXISTS participant_consents (
        id VARCHAR(64) PRIMARY KEY,
        participant_id VARCHAR(64) NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        campaign_id VARCHAR(64) NOT NULL,
        terms_version VARCHAR(32) NOT NULL,
        accepted_at VARCHAR(64) NOT NULL,
        ip_hash VARCHAR(64)
      );

      CREATE INDEX IF NOT EXISTS idx_consents_participant ON participant_consents(participant_id);

      CREATE TABLE IF NOT EXISTS spins (
        id VARCHAR(64) PRIMARY KEY,
        participant_id VARCHAR(64) NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        prize_id VARCHAR(64) NOT NULL REFERENCES prizes(id),
        idempotency_key VARCHAR(128),
        created_at VARCHAR(64) NOT NULL,
        ip_hash VARCHAR(64)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_spins_participant ON spins(participant_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spins_idempotency ON spins(participant_id, idempotency_key);

      CREATE TABLE IF NOT EXISTS promo_codes (
        id VARCHAR(64) PRIMARY KEY,
        code VARCHAR(64) UNIQUE NOT NULL,
        spin_id VARCHAR(64) NOT NULL REFERENCES spins(id) ON DELETE CASCADE,
        prize_id VARCHAR(64) NOT NULL REFERENCES prizes(id),
        participant_id VARCHAR(64) NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        created_at VARCHAR(64) NOT NULL,
        expires_at VARCHAR(64) NOT NULL,
        redeemed_at VARCHAR(64),
        qr_token VARCHAR(64) UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_promos_code ON promo_codes(code);
      CREATE INDEX IF NOT EXISTS idx_promos_status ON promo_codes(status);

      CREATE TABLE IF NOT EXISTS redemptions (
        id VARCHAR(64) PRIMARY KEY,
        promo_code_id VARCHAR(64) NOT NULL,
        promo_code VARCHAR(64) NOT NULL,
        participant_id VARCHAR(64),
        phone VARCHAR(32),
        prize_label VARCHAR(64),
        redeemed_by VARCHAR(64) NOT NULL,
        redeemed_at VARCHAR(64) NOT NULL,
        ip_hash VARCHAR(64),
        details TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_redemptions_code ON redemptions(promo_code);

      CREATE TABLE IF NOT EXISTS admin_users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        email VARCHAR(128) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id VARCHAR(64) PRIMARY KEY,
        admin_id VARCHAR(64) NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
        csrf_token VARCHAR(128) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        expires_at VARCHAR(64) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        timestamp VARCHAR(64) NOT NULL,
        admin_user VARCHAR(64),
        action VARCHAR(64) NOT NULL,
        target VARCHAR(128),
        result VARCHAR(32),
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS security_logs (
        id SERIAL PRIMARY KEY,
        timestamp VARCHAR(64) NOT NULL,
        ip_hash VARCHAR(64),
        participant_id VARCHAR(64),
        event_type VARCHAR(64) NOT NULL,
        details TEXT
      );

      -- Helpful view aliases matching requirements naming
      CREATE OR REPLACE VIEW campaigns AS SELECT * FROM campaign_settings;
      CREATE OR REPLACE VIEW consents AS SELECT * FROM participant_consents;
      CREATE OR REPLACE VIEW security_events AS SELECT * FROM security_logs;
    `);

    // Ensure qr_token column exists in existing promo_codes table
    try {
      await db.exec(`
        ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS qr_token VARCHAR(64) UNIQUE;
        CREATE INDEX IF NOT EXISTS idx_promos_qr_token ON promo_codes(qr_token);
      `);
      // Backfill any missing qr_tokens
      const missingTokens = await db.query('SELECT id FROM promo_codes WHERE qr_token IS NULL');
      for (const row of missingTokens) {
        const token = crypto.randomBytes(16).toString('hex');
        await db.run('UPDATE promo_codes SET qr_token = ? WHERE id = ?', [token, row.id]);
      }
    } catch (e) {
      console.warn('[PostgreSQL Migration Warning]', e.message);
    }

    // Ensure participants columns exist in existing PostgreSQL table
    try {
      await db.exec(`
        ALTER TABLE participants ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(32);
        ALTER TABLE participants ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(64) DEFAULT 'national_day_96';
        ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_seen_at VARCHAR(64);
        ALTER TABLE participants ADD COLUMN IF NOT EXISTS otp_code VARCHAR(16);
        ALTER TABLE participants ADD COLUMN IF NOT EXISTS otp_expires_at VARCHAR(64);
        ALTER TABLE participants ADD COLUMN IF NOT EXISTS otp_verified INTEGER DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_participants_norm_phone ON participants(normalized_phone);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_campaign_phone ON participants(campaign_id, normalized_phone);
      `);
    } catch (e) {
      console.warn('[PostgreSQL Participants Migration Warning]', e.message);
    }

    // Seed defaults for PostgreSQL
    const campaign = await db.get('SELECT id FROM campaign_settings WHERE id = 1');
    if (!campaign) {
      await db.run(`
        INSERT INTO campaign_settings (id, status, name, start_date, end_date, max_spins_per_participant, updated_at)
        VALUES (1, 'ACTIVE', 'Go Wash Saudi National Day 96 Exclusive', '2026-09-15T00:00:00Z', '2026-09-30T23:59:59Z', 1, ?)
      `, [new Date().toISOString()]);
    }

    const prizeCount = await db.get('SELECT COUNT(*) as count FROM prizes');
    if (parseInt(prizeCount.count, 10) === 0) {
      for (const p of initialPrizes) {
        await db.run(`
          INSERT INTO prizes (id, label, type, amount, subtext, probability, color, text_color, display_order, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [p.id, p.label, p.type, p.amount, p.subtext, p.probability, p.color, p.text_color, p.display_order]);
      }
    }

    const adminCount = await db.get('SELECT COUNT(*) as count FROM admin_users');
    if (parseInt(adminCount.count, 10) === 0) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(config.ADMIN_INITIAL_PASSWORD, salt);
      await db.run(`
        INSERT INTO admin_users (id, username, email, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [crypto.randomUUID(), config.ADMIN_INITIAL_USERNAME, config.ADMIN_INITIAL_EMAIL, hash, new Date().toISOString()]);
    }

  } else {
    // SQLite DDL
    sqliteDb.exec(`
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
        name TEXT,
        phone TEXT,
        normalized_phone TEXT,
        campaign_id TEXT NOT NULL DEFAULT 'national_day_96',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT,
        otp_code TEXT,
        otp_expires_at TEXT,
        otp_verified INTEGER NOT NULL DEFAULT 0,
        ip_hash TEXT,
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_participants_phone ON participants(phone);

      CREATE TABLE IF NOT EXISTS participant_consents (
        id TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        terms_version TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        ip_hash TEXT,
        FOREIGN KEY (participant_id) REFERENCES participants(id)
      );

      CREATE INDEX IF NOT EXISTS idx_consents_participant ON participant_consents(participant_id);

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
        qr_token TEXT UNIQUE,
        FOREIGN KEY (spin_id) REFERENCES spins(id),
        FOREIGN KEY (prize_id) REFERENCES prizes(id),
        FOREIGN KEY (participant_id) REFERENCES participants(id)
      );

      CREATE INDEX IF NOT EXISTS idx_promos_code ON promo_codes(code);
      CREATE INDEX IF NOT EXISTS idx_promos_status ON promo_codes(status);

      CREATE TABLE IF NOT EXISTS redemptions (
        id TEXT PRIMARY KEY,
        promo_code_id TEXT NOT NULL,
        promo_code TEXT NOT NULL,
        participant_id TEXT,
        phone TEXT,
        prize_label TEXT,
        redeemed_by TEXT NOT NULL,
        redeemed_at TEXT NOT NULL,
        ip_hash TEXT,
        details TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_redemptions_code ON redemptions(promo_code);

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

    // Views for SQLite
    try {
      sqliteDb.exec(`
        CREATE VIEW IF NOT EXISTS campaigns AS SELECT * FROM campaign_settings;
        CREATE VIEW IF NOT EXISTS consents AS SELECT * FROM participant_consents;
        CREATE VIEW IF NOT EXISTS security_events AS SELECT * FROM security_logs;
      `);
    } catch (e) {}

    // Ensure qr_token column exists in existing SQLite promo_codes table
    try {
      const tableInfo = sqliteDb.prepare("PRAGMA table_info(promo_codes)").all();
      const hasQrToken = tableInfo.some(col => col.name === 'qr_token');
      if (!hasQrToken) {
        sqliteDb.exec(`
          ALTER TABLE promo_codes ADD COLUMN qr_token TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_promos_qr_token ON promo_codes(qr_token);
        `);
      }
      const missingTokens = sqliteDb.prepare("SELECT id FROM promo_codes WHERE qr_token IS NULL").all();
      const updateStmt = sqliteDb.prepare("UPDATE promo_codes SET qr_token = ? WHERE id = ?");
      for (const row of missingTokens) {
        const token = crypto.randomBytes(16).toString('hex');
        updateStmt.run(token, row.id);
      }
    } catch (e) {
      console.warn('[SQLite Migration Warning]', e.message);
    }

    // Ensure participants columns exist in existing SQLite table
    try {
      const partInfo = sqliteDb.prepare("PRAGMA table_info(participants)").all();
      const colNames = partInfo.map(c => c.name);
      if (!colNames.includes('normalized_phone')) {
        sqliteDb.exec("ALTER TABLE participants ADD COLUMN normalized_phone TEXT;");
      }
      if (!colNames.includes('campaign_id')) {
        sqliteDb.exec("ALTER TABLE participants ADD COLUMN campaign_id TEXT DEFAULT 'national_day_96';");
      }
      if (!colNames.includes('last_seen_at')) {
        sqliteDb.exec("ALTER TABLE participants ADD COLUMN last_seen_at TEXT;");
      }
      if (!colNames.includes('otp_code')) {
        sqliteDb.exec("ALTER TABLE participants ADD COLUMN otp_code TEXT;");
      }
      if (!colNames.includes('otp_expires_at')) {
        sqliteDb.exec("ALTER TABLE participants ADD COLUMN otp_expires_at TEXT;");
      }
      if (!colNames.includes('otp_verified')) {
        sqliteDb.exec("ALTER TABLE participants ADD COLUMN otp_verified INTEGER DEFAULT 0;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_participants_norm_phone ON participants(normalized_phone);");
      sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_campaign_phone ON participants(campaign_id, normalized_phone);");
    } catch (e) {
      console.warn('[SQLite Participants Migration Warning]', e.message);
    }

    // Seed default campaign settings if empty
    const campaign = sqliteDb.prepare('SELECT id FROM campaign_settings WHERE id = 1').get();
    if (!campaign) {
      const now = new Date().toISOString();
      sqliteDb.prepare(`
        INSERT INTO campaign_settings (id, status, name, start_date, end_date, max_spins_per_participant, updated_at)
        VALUES (1, 'ACTIVE', 'Go Wash Saudi National Day 96 Exclusive', '2026-09-15T00:00:00Z', '2026-09-30T23:59:59Z', 1, ?)
      `).run(now);
    }

    // Seed default prizes if empty
    const prizeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM prizes').get();
    if (prizeCount.count === 0) {
      const insertPrize = sqliteDb.prepare(`
        INSERT INTO prizes (id, label, type, amount, subtext, probability, color, text_color, display_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      for (const p of initialPrizes) {
        insertPrize.run(p.id, p.label, p.type, p.amount, p.subtext, p.probability, p.color, p.text_color, p.display_order);
      }
    }

    // Seed default admin user if none exists
    const adminCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM admin_users').get();
    if (adminCount.count === 0) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(config.ADMIN_INITIAL_PASSWORD, salt);
      const adminId = crypto.randomUUID();
      const now = new Date().toISOString();
      sqliteDb.prepare(`
        INSERT INTO admin_users (id, username, email, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(adminId, config.ADMIN_INITIAL_USERNAME, config.ADMIN_INITIAL_EMAIL, hash, now);
    }
  }
}

// Immediate init for SQLite; Postgres will init via async promise
const initPromise = initSchema().catch(err => {
  console.error('[DB Init Error]', err);
});

db.initPromise = initPromise;

module.exports = db;
