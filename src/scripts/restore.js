const fs = require('fs');
const path = require('path');
const db = require('../db');
const { PRIORITY_TABLES } = require('./backup');

async function restoreBackup(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Backup file does not exist: ${filePath}`);
  }

  // Ensure DB initialized
  if (db.initPromise) {
    await db.initPromise;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const backupData = JSON.parse(raw);

  if (!backupData.tables) {
    throw new Error('Invalid backup file format: missing tables property');
  }

  const restoredCounts = {};

  // Restore order: independent tables first, then dependent foreign-key tables
  const orderedTables = [
    'campaign_settings',
    'prizes',
    'participants',
    'participant_consents',
    'spins',
    'promo_codes',
    'redemptions',
    'audit_logs'
  ];

  await db.transaction(async (tx) => {
    for (const table of orderedTables) {
      const rows = backupData.tables[table];
      if (!Array.isArray(rows) || rows.length === 0) {
        restoredCounts[table] = 0;
        continue;
      }

      let count = 0;
      for (const row of rows) {
        const keys = Object.keys(row);
        const values = Object.values(row);
        const placeholders = keys.map(() => '?').join(', ');
        const columns = keys.join(', ');

        if (db.isPg) {
          // PostgreSQL upsert or insert
          const conflictKey = table === 'campaign_settings' ? 'id' : (keys.includes('id') ? 'id' : keys[0]);
          const updateAssignments = keys
            .filter(k => k !== conflictKey)
            .map(k => `${k} = EXCLUDED.${k}`)
            .join(', ');

          const sql = updateAssignments.length > 0
            ? `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT (${conflictKey}) DO UPDATE SET ${updateAssignments}`
            : `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT (${conflictKey}) DO NOTHING`;

          await tx.run(sql, values);
        } else {
          // SQLite insert or replace
          const sql = `INSERT OR REPLACE INTO ${table} (${columns}) VALUES (${placeholders})`;
          await tx.run(sql, values);
        }
        count++;
      }
      restoredCounts[table] = count;
    }
  });

  return {
    success: true,
    file: filePath,
    sourceEngine: backupData.metadata?.engine,
    restoredAt: new Date().toISOString(),
    counts: restoredCounts
  };
}

if (require.main === module) {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node src/scripts/restore.js <path-to-backup.json>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), fileArg);
  restoreBackup(resolvedPath)
    .then(summary => {
      console.log('==================================================');
      console.log('✅ Database Restored Successfully from Backup');
      console.log('File:', summary.file);
      console.log('Restored Table Counts:');
      for (const [tbl, count] of Object.entries(summary.counts)) {
        console.log(`  - ${tbl}: ${count} records restored`);
      }
      console.log('==================================================');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Restore Failed:', err);
      process.exit(1);
    });
}

module.exports = { restoreBackup };
