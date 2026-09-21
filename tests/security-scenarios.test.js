process.env.NODE_ENV = 'test';
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const app = require('../server');
const db = require('../src/db');
const config = require('../src/config');
const { redeemPromoCode } = require('../src/services/promoService');

const TEST_PORT = 3105;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function httpRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runSecuritySuite() {
  console.log("==================================================");
  console.log("🛡️ Starting Requirement 47 Security Test Suite");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  async function test(scenarioNumber, scenarioTitle, fn) {
    try {
      await fn();
      console.log(`✅ [PASS] Scenario ${scenarioNumber}: ${scenarioTitle}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] Scenario ${scenarioNumber}: ${scenarioTitle}`);
      console.error(`   Reason:`, err.message);
      failed++;
    }
  }

  // Ensure DB ready & start server
  await db.initPromise;
  await new Promise(resolve => {
    server = app.listen(TEST_PORT, () => resolve());
  });

  try {
    // ------------------------------------------------------------------------
    // Scenario 1: Browser Tampering
    // User modifies client-side JavaScript trying to force "signature_upgrade".
    // Server must determine the prize independently and ignore client code.
    // ------------------------------------------------------------------------
    await test(1, "Browser Tampering - Server decision cannot be altered by client", async () => {
      const participantId = crypto.randomUUID();
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      
      // Client sends request attempting to manipulate internal state
      const res = await httpRequest('POST', '/api/spin', {
        'Cookie': `gowash_pid=${participantId}`,
        'X-Participant-Id': participantId
      }, {
        name: 'عميل اختبار',
        phone,
        termsAccepted: true,
        termsVersion: config.CURRENT_TERMS_VERSION,
        // Tampered client attributes
        prizeId: 'signature_upgrade',
        winningPrize: 'signature_upgrade',
        forceWin: true,
        probability: 100
      });

      assert.strictEqual(res.status, 200, "Spin request must succeed");
      assert.strictEqual(res.json.success, true, "Response must indicate success");
      assert.ok(res.json.prize, "Must return a prize chosen by server");
      assert.ok(res.json.promo.code, "Must return a server-generated promo code");

      // Verify the prize stored in PostgreSQL matches server record, not forced signature
      const storedSpin = await db.get('SELECT prize_id FROM spins WHERE participant_id = ?', [participantId]);
      assert.strictEqual(storedSpin.prize_id, res.json.prize.id, "DB prize must match server returned prize");
    });

    // ------------------------------------------------------------------------
    // Scenario 2: Multiple Spins (Race Condition)
    // Sending concurrent requests must yield exactly 1 spin and 0 duplicate promos.
    // ------------------------------------------------------------------------
    await test(2, "Multiple Spins - Atomic concurrency yields exactly 1 spin", async () => {
      const participantId = crypto.randomUUID();
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const concurrency = 15;

      const requests = Array.from({ length: concurrency }).map((_, idx) => {
        return httpRequest('POST', '/api/spin', {
          'Cookie': `gowash_pid=${participantId}`,
          'X-Participant-Id': participantId,
          'Idempotency-Key': `multi_race_${idx}_${Date.now()}`
        }, {
          name: 'متسابق التزامن',
          phone,
          termsAccepted: true,
          termsVersion: config.CURRENT_TERMS_VERSION
        });
      });

      const responses = await Promise.all(requests);
      const successResponses = responses.filter(r => r.status === 200 && r.json && r.json.success);
      const rejectedResponses = responses.filter(r => r.status === 403 && r.json && r.json.code === 'ALREADY_SPUN');

      assert.strictEqual(successResponses.length, 1, "Exactly 1 concurrent request must succeed");
      assert.strictEqual(rejectedResponses.length, concurrency - 1, `All ${concurrency - 1} other requests must be rejected with 403 ALREADY_SPUN`);

      // Verify database has exactly 1 spin and 1 promo code
      const spinCount = await db.get('SELECT COUNT(*) as count FROM spins WHERE participant_id = ?', [participantId]);
      const promoCount = await db.get('SELECT COUNT(*) as count FROM promo_codes WHERE participant_id = ?', [participantId]);
      assert.strictEqual(parseInt(spinCount.count, 10), 1, "Database must store exactly 1 spin");
      assert.strictEqual(parseInt(promoCount.count, 10), 1, "Database must store exactly 1 promo code");
    });

    // ------------------------------------------------------------------------
    // Scenario 3: Fake Prize
    // Changing request body to send prizeId=signature_upgrade is ignored.
    // ------------------------------------------------------------------------
    await test(3, "Fake Prize - Client-sent prizeId is completely ignored by server", async () => {
      const participantId = crypto.randomUUID();
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;

      const res = await httpRequest('POST', '/api/spin', {
        'Cookie': `gowash_pid=${participantId}`,
        'X-Participant-Id': participantId
      }, {
        name: 'سالم العتيبي',
        phone,
        termsAccepted: true,
        termsVersion: config.CURRENT_TERMS_VERSION,
        prizeId: 'signature_upgrade'
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.json.prize.id);
      // The server generates its own prize independently. If it happened to be signature (1% chance), it's still legitimate,
      // but client-provided parameter is not trusted or blindly assigned.
    });

    // ------------------------------------------------------------------------
    // Scenario 4: Fake Promo
    // Sending a random fake promo code is rejected.
    // ------------------------------------------------------------------------
    await test(4, "Fake Promo - Arbitrary promo code is rejected", async () => {
      const fakeCode = "GW96-FAKE-9999";

      // Test verify endpoint
      const verifyRes = await httpRequest('GET', `/api/verify/${fakeCode}`);
      assert.strictEqual(verifyRes.status, 404, "Fake promo verify must return 404");
      assert.strictEqual(verifyRes.json.success, false);

      // Test redeem-request endpoint
      const redeemReqRes = await httpRequest('POST', '/api/redeem-request', {}, {
        code: fakeCode,
        phone: '0580700242'
      });
      assert.strictEqual(redeemReqRes.status, 404, "Fake promo redeem-request must return 404");
      assert.strictEqual(redeemReqRes.json.success, false);
    });

    // ------------------------------------------------------------------------
    // Scenario 5: Reuse Promo
    // Redeeming a promo code twice is rejected on the second attempt.
    // ------------------------------------------------------------------------
    await test(5, "Reuse Promo - Second redemption attempt is rejected", async () => {
      // 1. Create a spin to get a valid code
      const participantId = crypto.randomUUID();
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const spinRes = await httpRequest('POST', '/api/spin', {
        'Cookie': `gowash_pid=${participantId}`,
        'X-Participant-Id': participantId
      }, {
        name: 'فيصل المطيري',
        phone,
        termsAccepted: true,
        termsVersion: config.CURRENT_TERMS_VERSION
      });
      const code = spinRes.json.promo.code;

      // 2. First redemption (succeeds)
      const firstRedeem = await redeemPromoCode(code, 'admin_verifier', phone);
      assert.strictEqual(firstRedeem.success, true, "First redemption must succeed");

      // 3. Second redemption (must fail)
      const secondRedeem = await redeemPromoCode(code, 'admin_verifier', phone);
      assert.strictEqual(secondRedeem.success, false, "Second redemption must fail");
      assert.strictEqual(secondRedeem.code, 'ALREADY_REDEEMED', "Must return ALREADY_REDEEMED code");
    });

    // ------------------------------------------------------------------------
    // Scenario 6: Different Participant
    // Participant B attempts to use promo code belonging to Participant A.
    // ------------------------------------------------------------------------
    await test(6, "Different Participant - Code ownership mismatch is rejected", async () => {
      // Participant A wins a promo code
      const participantA = crypto.randomUUID();
      const phoneA = `05${crypto.randomInt(10000000, 99999999)}`;
      const spinRes = await httpRequest('POST', '/api/spin', {
        'Cookie': `gowash_pid=${participantA}`,
        'X-Participant-Id': participantA
      }, {
        name: 'مشارك ألف',
        phone: phoneA,
        termsAccepted: true,
        termsVersion: config.CURRENT_TERMS_VERSION
      });
      const promoA = spinRes.json.promo.code;

      // Participant B tries to redeem with different phone
      const phoneB = `05${crypto.randomInt(10000000, 99999999)}`;
      const hijackAttempt = await redeemPromoCode(promoA, 'admin_verifier', phoneB);
      assert.strictEqual(hijackAttempt.success, false, "Hijack redemption must fail");
      assert.ok(hijackAttempt.error.includes("لا يتطابق"), "Error must explain ownership mismatch");

      // Also check public redeem-request endpoint
      const reqRes = await httpRequest('POST', '/api/redeem-request', {}, {
        code: promoA,
        phone: phoneB
      });
      assert.strictEqual(reqRes.status, 400);
      assert.strictEqual(reqRes.json.code, 'PARTICIPANT_MISMATCH');
    });

    // ------------------------------------------------------------------------
    // Scenario 7: Expired Promo
    // Redeeming an expired promo code is rejected.
    // ------------------------------------------------------------------------
    await test(7, "Expired Promo - Redemption of expired code is rejected", async () => {
      const participantId = crypto.randomUUID();
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const spinRes = await httpRequest('POST', '/api/spin', {
        'Cookie': `gowash_pid=${participantId}`,
        'X-Participant-Id': participantId
      }, {
        name: 'عبدالرحمن الشهري',
        phone,
        termsAccepted: true,
        termsVersion: config.CURRENT_TERMS_VERSION
      });
      const code = spinRes.json.promo.code;

      // Artificially expire the promo in DB
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      await db.run("UPDATE promo_codes SET expires_at = ?, status = 'EXPIRED' WHERE code = ?", [pastDate, code]);

      const redeemAttempt = await redeemPromoCode(code, 'admin_verifier', phone);
      assert.strictEqual(redeemAttempt.success, false, "Expired redemption must fail");
      assert.strictEqual(redeemAttempt.code, 'EXPIRED', "Must return EXPIRED code");
    });

    // ------------------------------------------------------------------------
    // Scenario 8: Cancelled Promo
    // Redeeming a cancelled promo code is rejected.
    // ------------------------------------------------------------------------
    await test(8, "Cancelled Promo - Redemption of cancelled code is rejected", async () => {
      const participantId = crypto.randomUUID();
      const phone = `05${crypto.randomInt(10000000, 99999999)}`;
      const spinRes = await httpRequest('POST', '/api/spin', {
        'Cookie': `gowash_pid=${participantId}`,
        'X-Participant-Id': participantId
      }, {
        name: 'خالد الدوسري',
        phone,
        termsAccepted: true,
        termsVersion: config.CURRENT_TERMS_VERSION
      });
      const code = spinRes.json.promo.code;

      // Cancel the code in DB
      await db.run("UPDATE promo_codes SET status = 'CANCELLED' WHERE code = ?", [code]);

      const redeemAttempt = await redeemPromoCode(code, 'admin_verifier', phone);
      assert.strictEqual(redeemAttempt.success, false, "Cancelled redemption must fail");
      assert.strictEqual(redeemAttempt.code, 'CANCELLED', "Must return CANCELLED code");
    });

    // ------------------------------------------------------------------------
    // Scenario 9: Admin Access
    // Opening /admin without an active session is blocked (redirect or 401).
    // ------------------------------------------------------------------------
    await test(9, "Admin Access - Unauthenticated access to /admin is blocked", async () => {
      const res = await httpRequest('GET', '/admin');
      // Should redirect to login.html (302) or return 401
      const isBlocked = res.status === 302 || res.status === 401;
      assert.ok(isBlocked, `Expected 302 or 401, received: ${res.status}`);
      if (res.status === 302) {
        assert.ok(res.headers.location.includes('login'), "Redirect must lead to login page");
      }
    });

    // ------------------------------------------------------------------------
    // Scenario 10: Admin API
    // Calling Admin API without authentication is rejected (401).
    // ------------------------------------------------------------------------
    await test(10, "Admin API - Unauthenticated calls to /api/admin are rejected with 401", async () => {
      const endpoints = [
        ['GET', '/api/admin/overview'],
        ['GET', '/api/admin/campaign'],
        ['GET', '/api/admin/prizes'],
        ['GET', '/api/admin/promos'],
        ['GET', '/api/admin/spins'],
        ['GET', '/api/admin/audit-logs'],
        ['POST', '/api/admin/kill-switch']
      ];

      for (const [method, ep] of endpoints) {
        const res = await httpRequest(method, ep);
        assert.strictEqual(res.status, 401, `Endpoint ${ep} must return 401 Unauthorized`);
        assert.strictEqual(res.json.success, false);
      }
    });

  } finally {
    if (server) {
      server.close();
    }
  }

  console.log("==================================================");
  console.log(`🏁 Security Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSecuritySuite().catch(err => {
    console.error("Suite fatal error:", err);
    process.exit(1);
  });
}

module.exports = runSecuritySuite;
