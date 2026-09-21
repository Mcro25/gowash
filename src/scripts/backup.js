const fs = require('fs');
const path = require('path');
const db = require('../db');

const PRIORITY_TABLES = [
  'participants',
  'spins',
  'promo_codes',
  'redemptions',
  'participant_consents',
  'audit_logs',
  'prizes',
  'campaign_settings'
];

async function createBackup(customDir = null) {
  // Ensure DB schema initialized
  if (db.initPromise) {
    await db.initPromise;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = customDir || path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupData = {
    metadata: {
      createdAt: new Date().toISOString(),
      timezone: 'Asia/Riyadh',
      engine: db.isPg ? 'PostgreSQL' : 'SQLite',
      version: '1.0'
    },
    tables: {}
  };

  for (const table of PRIORITY_TABLES) {
    try {
      const rows = await db.all(`SELECT * FROM ${table}`);
      backupData.tables[table] = rows || [];
    } catch (err) {
      console.warn(`[Backup Warning] Could not export table ${table}: ${err.message}`);
      backupData.tables[table] = [];
    }
  }

  const filename = `gowash-backup-${timestamp}.json`;
  const filePath = path.join(backupDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf8');

  const summary = {
    file: filePath,
    filename,
    engine: backupData.metadata.engine,
    createdAt: backupData.metadata.createdAt,
    counts: Object.fromEntries(
      Object.entries(backupData.tables).map(([t, rows]) => [t, rows.length])
    )
  };

  return summary;
}

if (require.main === module) {
  createBackup()
    .then(summary => {
      console.log('==================================================');
      console.log('✅ Database Backup Created Successfully');
      console.log('File:', summary.file);
      console.log('Engine:', summary.engine);
      console.log('Summary of Priority Tables:');
      for (const [tbl, count] of Object.entries(summary.counts)) {
        console.log(`  - ${tbl}: ${count} records`);
      }
      console.log('==================================================');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Backup Failed:', err);
      process.exit(1);
    });
}

module.exports = { createBackup, PRIORITY_TABLES };
