process.env.NODE_ENV = 'test';
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const db = require('../src/db');
const { createBackup } = require('../src/scripts/backup');
const { restoreBackup } = require('../src/scripts/restore');

const TEST_PORT = 3199;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;
let adminSessionCookie = '';
let adminCsrfToken = '';

async function runAcceptanceTests() {
  console.log("==================================================");
  console.log("🎯 Running 12 Acceptance Criteria Verification Tests");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // Helper to spin a prize
  async function spinPrize(name, phone) {
    const cookie = `gowash_pid=${crypto.randomUUID()}`;
    const res = await fetch(`${BASE_URL}/api/spin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        termsAccepted: true,
        termsVersion: "1.1",
        name,
        phone
      })
    });
    const data = await res.json();
    return { status: res.status, data, cookie };
  }

  try {
    // Start Server
    await new Promise(resolve => {
      server = app.listen(TEST_PORT, () => resolve());
    });

    // Login Admin
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "GoWash96@Admin" })
    });
    assert.strictEqual(loginRes.status, 200, "Admin login must succeed");
    const loginData = await loginRes.json();
    adminCsrfToken = loginData.csrfToken;
    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : (loginRes.headers.get("set-cookie") || "").split(",");
    for (const sc of setCookies) {
      if (sc.includes("gowash_admin_session=")) {
        const match = sc.match(/gowash_admin_session=[^;]+/);
        if (match) adminSessionCookie = match[0];
      }
    }
    assert.ok(adminSessionCookie, "Must have admin session cookie");

    // ----------------------------------------------------
    // Criterion 1: Promo Code ينشأ ومعه expiresAt
    // ----------------------------------------------------
    let crit1Promo = null;
    let crit1QrToken = null;
    await test("Criteria 1: Promo Code ينشأ ومعه expiresAt", async () => {
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const { status, data } = await spinPrize("عميل معيار 1", phone);
      assert.strictEqual(status, 200);
      assert.strictEqual(data.success, true);
      assert.ok(data.promo, "Promo object must be returned");
      assert.ok(data.promo.code, "Promo code must be generated");
      assert.ok(data.promo.expiresAt, "expiresAt must be returned in promo object");
      assert.ok(data.promo.qrToken, "qrToken must be returned in promo object");
      assert.ok(data.promo.verifyUrl, "verifyUrl must be returned in promo object");
      assert.ok(data.promo.qrDataUrl, "qrDataUrl must be returned in promo object");

      crit1Promo = data.promo.code;
      crit1QrToken = data.promo.qrToken;

      // Verify expiration is in the future
      const expiresTime = new Date(data.promo.expiresAt).getTime();
      const now = Date.now();
      assert.ok(expiresTime > now, "expiresAt must be a future date");

      // Verify database record directly
      const dbRow = await db.get("SELECT * FROM promo_codes WHERE code = ?", [crit1Promo]);
      assert.ok(dbRow, "Promo code record must exist in database");
      assert.ok(dbRow.expires_at, "Database row must have expires_at populated");
      assert.strictEqual(new Date(dbRow.expires_at).toISOString(), new Date(data.promo.expiresAt).toISOString());
      assert.strictEqual(dbRow.qr_token, crit1QrToken, "Database row must have qr_token");
    });

    // ----------------------------------------------------
    // Criterion 2: بعد انتهاء الوقت يتحول منطقيًا إلى EXPIRED
    // ----------------------------------------------------
    await test("Criteria 2: بعد انتهاء الوقت يتحول منطقيًا إلى EXPIRED", async () => {
      // Artificially expire crit1Promo by setting expires_at to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      await db.run("UPDATE promo_codes SET expires_at = ? WHERE code = ?", [twoHoursAgo, crit1Promo]);

      // Public verification endpoint
      const pubRes = await fetch(`${BASE_URL}/api/verify/${crit1QrToken}`);
      assert.strictEqual(pubRes.status, 200);
      const pubData = await pubRes.json();
      assert.strictEqual(pubData.success, true);
      assert.strictEqual(pubData.status, "EXPIRED", "Status must logically transition to EXPIRED");
      assert.ok(pubData.statusArabic.includes("انتهت صلاحية هذه الجائزة"));

      // Admin verification endpoint
      const adminRes = await fetch(`${BASE_URL}/api/admin/verify/${crit1Promo}`, {
        headers: { "Cookie": adminSessionCookie }
      });
      assert.strictEqual(adminRes.status, 200);
      const adminData = await adminRes.json();
      assert.strictEqual(adminData.status, "EXPIRED", "Admin verify must also report EXPIRED");
    });

    // ----------------------------------------------------
    // Criterion 3: رفض استرداد كود منتهي الصلاحية
    // ----------------------------------------------------
    await test("Criteria 3: رفض استرداد كود منتهي الصلاحية", async () => {
      const redeemRes = await fetch(`${BASE_URL}/api/admin/promos/${crit1Promo}/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });

      assert.strictEqual(redeemRes.status, 400, "Redeeming expired promo must be rejected with 400");
      const redeemData = await redeemRes.json();
      assert.strictEqual(redeemData.success, false);
      assert.strictEqual(redeemData.code, "EXPIRED");
      assert.ok(redeemData.error.includes("انتهت صلاحية هذه الجائزة"));

      // Verify promo code status in DB was not mutated to REDEEMED
      const dbRow = await db.get("SELECT status FROM promo_codes WHERE code = ?", [crit1Promo]);
      assert.notStrictEqual(dbRow.status, "REDEEMED", "DB status must not be REDEEMED");

      // Verify no redemption record was created
      const redRow = await db.get("SELECT * FROM redemptions WHERE promo_code = ?", [crit1Promo]);
      assert.ok(!redRow, "No redemption record should be inserted for expired code");
    });

    // ----------------------------------------------------
    // Criterion 4: توليد QR صالح
    // ----------------------------------------------------
    let crit4Code = null;
    let crit4QrToken = null;
    await test("Criteria 4: توليد QR صالح", async () => {
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const { status, data } = await spinPrize("عميل معيار 4", phone);
      assert.strictEqual(status, 200);
      crit4Code = data.promo.code;
      crit4QrToken = data.promo.qrToken;

      assert.ok(crit4QrToken, "QR Token must exist");
      assert.strictEqual(crit4QrToken.length, 32, "QR Token should be a 32-char hex string");

      // Fetch public verification by qrToken
      const verifyRes = await fetch(`${BASE_URL}/api/verify/${crit4QrToken}`);
      assert.strictEqual(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.strictEqual(verifyData.success, true);
      assert.strictEqual(verifyData.status, "ACTIVE");
      assert.strictEqual(verifyData.code, crit4Code);

      // Fetch QR image directly
      const qrRes = await fetch(`${BASE_URL}/api/qr/${crit4QrToken}`);
      assert.strictEqual(qrRes.status, 200);
      assert.ok(qrRes.headers.get("content-type").includes("image/png"), "Must return image/png");
      const imgBuffer = await qrRes.arrayBuffer();
      assert.ok(imgBuffer.byteLength > 100, "Image buffer must be valid non-empty PNG");
    });

    // ----------------------------------------------------
    // Criterion 5: رفض QR غير صالح
    // ----------------------------------------------------
    await test("Criteria 5: رفض QR غير صالح", async () => {
      const invalidToken = "fake-invalid-token-1234567890abcdef";

      // Public verification returns 404
      const verifyRes = await fetch(`${BASE_URL}/api/verify/${invalidToken}`);
      assert.strictEqual(verifyRes.status, 404);
      const verifyData = await verifyRes.json();
      assert.strictEqual(verifyData.success, false);
      assert.strictEqual(verifyData.code, "NOT_FOUND");

      // QR image returns 404
      const qrRes = await fetch(`${BASE_URL}/api/qr/${invalidToken}`);
      assert.strictEqual(qrRes.status, 404);
    });

    // ----------------------------------------------------
    // Criterion 6: QR لكود مستخدم يظهر REDEEMED (تم استخدام هذه الجائزة مسبقاً)
    // ----------------------------------------------------
    await test("Criteria 6: QR لكود مستخدم يظهر REDEEMED (تم استخدام هذه الجائزة مسبقاً)", async () => {
      // Redeem crit4Code
      const redeemRes = await fetch(`${BASE_URL}/api/admin/promos/${crit4Code}/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(redeemRes.status, 200);
      const redeemData = await redeemRes.json();
      assert.strictEqual(redeemData.success, true);

      // Verify QR shows REDEEMED
      const verifyRes = await fetch(`${BASE_URL}/api/verify/${crit4QrToken}`);
      assert.strictEqual(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.strictEqual(verifyData.status, "REDEEMED");
      assert.ok(
        verifyData.statusArabic.includes("تم استخدام هذه الجائزة مسبقاً") ||
        verifyData.statusArabic.includes("تم استخدام هذه الجائزة مسبقًا"),
        "Arabic status must state prize was previously redeemed"
      );
      assert.ok(verifyData.dates.redeemedAt, "Must include redeemedAt date");
    });

    // ----------------------------------------------------
    // Criterion 7: QR لكود ملغي يظهر CANCELLED (هذه الجائزة ملغاة)
    // ----------------------------------------------------
    await test("Criteria 7: QR لكود ملغي يظهر CANCELLED (هذه الجائزة ملغاة)", async () => {
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const { status, data } = await spinPrize("عميل معيار 7", phone);
      assert.strictEqual(status, 200);
      const code = data.promo.code;
      const qrToken = data.promo.qrToken;

      // Cancel promo code
      const cancelRes = await fetch(`${BASE_URL}/api/admin/promos/${code}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        },
        body: JSON.stringify({ reason: "إلغاء تجريبي للمعيار 7" })
      });
      assert.strictEqual(cancelRes.status, 200);

      // Verify QR reflects CANCELLED
      const verifyRes = await fetch(`${BASE_URL}/api/verify/${qrToken}`);
      assert.strictEqual(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.strictEqual(verifyData.status, "CANCELLED");
      assert.ok(verifyData.statusArabic.includes("هذه الجائزة ملغاة"), "Arabic status must state code is cancelled");
    });

    // ----------------------------------------------------
    // Criterion 8: منع استرداد الكود مرتين
    // ----------------------------------------------------
    await test("Criteria 8: منع استرداد الكود مرتين", async () => {
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const { status, data } = await spinPrize("عميل معيار 8", phone);
      assert.strictEqual(status, 200);
      const code = data.promo.code;

      // 1st redemption -> Success
      const firstRes = await fetch(`${BASE_URL}/api/admin/promos/${code}/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(firstRes.status, 200);
      const firstData = await firstRes.json();
      assert.strictEqual(firstData.success, true);

      // 2nd redemption -> Rejection
      const secondRes = await fetch(`${BASE_URL}/api/admin/promos/${code}/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(secondRes.status, 400);
      const secondData = await secondRes.json();
      assert.strictEqual(secondData.success, false);
      assert.strictEqual(secondData.code, "ALREADY_REDEEMED");
      assert.ok(
        secondData.error.includes("تم استخدام هذه الجائزة مسبقاً") ||
        secondData.error.includes("تم استخدام هذه الجائزة مسبقًا")
      );
    });

    // ----------------------------------------------------
    // Criterion 9: Concurrent redemptions: 1 success فقط والباقي فشل
    // ----------------------------------------------------
    await test("Criteria 9: Concurrent redemptions: 1 success فقط والباقي فشل", async () => {
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const { status, data } = await spinPrize("عميل معيار 9", phone);
      assert.strictEqual(status, 200);
      const code = data.promo.code;

      // Fire 15 concurrent redemption requests
      const promises = Array.from({ length: 15 }, () =>
        fetch(`${BASE_URL}/api/admin/promos/${code}/redeem`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cookie": adminSessionCookie,
            "x-csrf-token": adminCsrfToken
          }
        })
      );

      const responses = await Promise.all(promises);
      const status200 = responses.filter(r => r.status === 200);
      const status400 = responses.filter(r => r.status === 400);

      assert.strictEqual(status200.length, 1, "Exactly 1 concurrent request must succeed");
      assert.strictEqual(status400.length, 14, "All other concurrent requests must be rejected with 400");

      // Verify only 1 row exists in redemptions
      const countRow = await db.get("SELECT COUNT(*) as count FROM redemptions WHERE promo_code = ?", [code]);
      assert.strictEqual(parseInt(countRow.count, 10), 1, "Exactly 1 redemption row must be recorded in DB");
    });

    // ----------------------------------------------------
    // Criterion 10: تسجيل الاسترداد في جدول redemptions و audit_logs
    // ----------------------------------------------------
    await test("Criteria 10: تسجيل الاسترداد في جدول redemptions و audit_logs", async () => {
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const { status, data } = await spinPrize("عميل معيار 10", phone);
      assert.strictEqual(status, 200);
      const code = data.promo.code;

      const redeemRes = await fetch(`${BASE_URL}/api/admin/promos/${code}/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(redeemRes.status, 200);

      // Check redemptions table
      const redemptionRow = await db.get("SELECT * FROM redemptions WHERE promo_code = ?", [code]);
      assert.ok(redemptionRow, "Redemption record must exist in redemptions table");
      assert.strictEqual(redemptionRow.promo_code, code);
      assert.strictEqual(redemptionRow.redeemed_by, "admin");
      assert.ok(redemptionRow.redeemed_at, "redeemed_at must be populated");
      assert.ok(redemptionRow.participant_id, "participant_id must be populated");

      // Check audit_logs table
      const auditRow = await db.get(
        "SELECT * FROM audit_logs WHERE target = ? AND action = 'PROMO_REDEEMED' ORDER BY timestamp DESC LIMIT 1",
        [code]
      );
      assert.ok(auditRow, "Audit log record must exist for PROMO_REDEEMED");
      assert.strictEqual(auditRow.admin_user, "admin");
      assert.strictEqual(auditRow.result || auditRow.status, "SUCCESS");
    });

    // ----------------------------------------------------
    // Criterion 11: DB Backup يعمل واسترجاع البيانات يعمل
    // ----------------------------------------------------
    await test("Criteria 11: DB Backup يعمل واسترجاع البيانات يعمل", async () => {
      // 1. Create a live database backup
      const backupSummary = await createBackup();
      assert.ok(backupSummary.file, "Backup file path must be returned");
      assert.ok(fs.existsSync(backupSummary.file), "Backup file must exist on disk");

      const fileContent = fs.readFileSync(backupSummary.file, 'utf8');
      const parsedData = JSON.parse(fileContent);

      assert.ok(parsedData.metadata, "Backup must include metadata");
      assert.ok(parsedData.tables, "Backup must include tables");

      // Verify all 6 priority tables exist in backup
      const priorityTables = ['participants', 'spins', 'promo_codes', 'redemptions', 'participant_consents', 'audit_logs'];
      for (const table of priorityTables) {
        assert.ok(Array.isArray(parsedData.tables[table]), `Priority table '${table}' must be an array in backup`);
      }

      // 2. Insert a distinct canary participant and promo code
      const canaryId = `canary_${Date.now()}`;
      const canaryPhone = `059999${crypto.randomInt(1000, 9999)}`;
      const canaryCode = `GW96-CANARY-${crypto.randomInt(1000, 9999)}`;
      const canaryQrToken = crypto.randomBytes(16).toString('hex');
      const nowIso = new Date().toISOString();
      const futureIso = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

      await db.run(
        "INSERT INTO participants (id, name, phone, first_seen_at) VALUES (?, ?, ?, ?)",
        [canaryId, "طائر الكناري للاختبار", canaryPhone, nowIso]
      );
      const prizeRow = await db.get("SELECT id FROM prizes WHERE is_active = 1 LIMIT 1");
      const prizeId = prizeRow ? prizeRow.id : "signature_upgrade";
      const spinId = `spin_${Date.now()}`;

      await db.run(
        "INSERT INTO spins (id, participant_id, prize_id, created_at) VALUES (?, ?, ?, ?)",
        [spinId, canaryId, prizeId, nowIso]
      );

      const promoId = `promo_${Date.now()}`;
      await db.run(
        `INSERT INTO promo_codes (id, code, spin_id, prize_id, participant_id, status, created_at, expires_at, qr_token)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [promoId, canaryCode, spinId, prizeId, canaryId, nowIso, futureIso, canaryQrToken]
      );

      // 3. Create backup 2 containing the canary
      const backup2 = await createBackup();
      assert.ok(fs.existsSync(backup2.file));

      // 4. Delete canary from database
      await db.run("DELETE FROM promo_codes WHERE code = ?", [canaryCode]);
      await db.run("DELETE FROM spins WHERE participant_id = ?", [canaryId]);
      await db.run("DELETE FROM participants WHERE id = ?", [canaryId]);

      // Confirm deletion
      const deletedPromo = await db.get("SELECT * FROM promo_codes WHERE code = ?", [canaryCode]);
      assert.ok(!deletedPromo, "Canary must be deleted prior to restore");

      // 5. Restore from backup 2
      const restoreResult = await restoreBackup(backup2.file);
      assert.strictEqual(restoreResult.success, true, "Restore process must succeed");

      // 6. Verify canary was restored
      const restoredPromo = await db.get("SELECT * FROM promo_codes WHERE code = ?", [canaryCode]);
      assert.ok(restoredPromo, "Canary promo code must be successfully restored from backup");
      assert.strictEqual(restoredPromo.code, canaryCode);
      assert.strictEqual(restoredPromo.qr_token, canaryQrToken);

      const restoredParticipant = await db.get("SELECT * FROM participants WHERE id = ?", [canaryId]);
      assert.ok(restoredParticipant, "Canary participant must be restored");
      assert.strictEqual(restoredParticipant.phone, canaryPhone);

      // Clean up backup files created during test
      try { fs.unlinkSync(backupSummary.file); } catch (e) {}
      try { fs.unlinkSync(backup2.file); } catch (e) {}
    });

    // ----------------------------------------------------
    // Criterion 12: عدم تسريب بيانات حساسة في الـ QR
    // ----------------------------------------------------
    await test("Criteria 12: عدم تسريب بيانات حساسة في الـ QR", async () => {
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const { status, data } = await spinPrize("عميل معيار 12", phone);
      assert.strictEqual(status, 200);

      const qrToken = data.promo.qrToken;
      const verifyUrl = data.promo.verifyUrl;

      // 1. Check token structure: purely random hex, no base64 encoded sensitive payload
      assert.strictEqual(/^[a-f0-9]{32}$/.test(qrToken), true, "qrToken must be random 32-char hex");

      // 2. Check verifyUrl: contains only domain path and qrToken
      assert.ok(verifyUrl.endsWith(`/verify/${qrToken}`), "URL only contains sanitized /verify/:token path");

      // 3. Check public verification endpoint response
      const verifyRes = await fetch(`${BASE_URL}/api/verify/${qrToken}`);
      const payload = await verifyRes.json();

      // Ensure NO sensitive internal keys are exposed
      assert.strictEqual(payload.id, undefined, "Must NOT expose database primary key id");
      assert.strictEqual(payload.probability, undefined, "Must NOT expose prize probability");
      assert.strictEqual(payload.participant_id, undefined, "Must NOT expose internal participant_id");
      assert.strictEqual(payload.password, undefined, "Must NOT expose passwords");
      assert.strictEqual(payload.password_hash, undefined, "Must NOT expose password hashes");
      assert.strictEqual(payload.spin_id, undefined, "Must NOT expose spin_id");
      assert.strictEqual(payload.weights, undefined, "Must NOT expose odds weights");

      // Check allowed sanitized fields
      assert.ok(payload.code, "Safe: Promo code");
      assert.ok(payload.status, "Safe: Status");
      assert.ok(payload.prize, "Safe: Prize public label and details");
      assert.ok(payload.dates, "Safe: Creation and expiration dates");
    });

  } finally {
    if (server) {
      server.close();
    }
  }

  console.log("==================================================");
  console.log(`🏁 Acceptance Tests Completed: ${passed} Passed, ${failed} Failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAcceptanceTests().catch(err => {
  console.error("Fatal Error running acceptance tests:", err);
  process.exit(1);
});
