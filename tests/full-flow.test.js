const assert = require('node:assert');
const http = require('node:http');
const path = require('path');
const crypto = require('node:crypto');
const app = require('../server');
const db = require('../src/db');

const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("==================================================");
  console.log("🚀 Starting Full-Flow Verification Tests for Go Wash");
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

  // Start HTTP Server
  await new Promise(resolve => {
    server = app.listen(TEST_PORT, () => resolve());
  });

  try {
    // ----------------------------------------------------
    // Test 1: Public Campaign Metadata & Sanity Check
    // ----------------------------------------------------
    await test("1. Public Campaign API returns metadata without probability leaks", async () => {
      const res = await fetch(`${BASE_URL}/api/campaign`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.campaign);
      assert.ok(Array.isArray(data.prizes));
      assert.strictEqual(data.prizes.length, 6);

      // Verify no probability is exposed
      for (const p of data.prizes) {
        assert.strictEqual(p.probability, undefined, "Probability must NOT be exposed to client");
        assert.strictEqual(p.weight, undefined, "Weight must NOT be exposed to client");
        assert.ok(p.id);
        assert.ok(p.label);
      }
    });

    // ----------------------------------------------------
    // Test 2: First Spin for a new participant
    // ----------------------------------------------------
    const participant1Cookie = `gowash_pid=${crypto.randomUUID()}`;
    let p1PromoCode = "";
    let p1PrizeId = "";

    await test("2. First Spin executes successfully and returns valid prize and promo", async () => {
      const res = await fetch(`${BASE_URL}/api/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": participant1Cookie,
          "Idempotency-Key": "test_idemp_1"
        },
        body: JSON.stringify({ idempotencyKey: "test_idemp_1" })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.prize);
      assert.ok(data.prize.id);
      assert.ok(data.prize.label);
      assert.ok(data.promo);
      assert.match(data.promo.code, /^GW96-[2-9A-Z]{5}$/);

      // Verify probability is not leaked in spin response
      assert.strictEqual(data.prize.probability, undefined);

      p1PromoCode = data.promo.code;
      p1PrizeId = data.prize.id;
    });

    // ----------------------------------------------------
    // Test 3: Second Spin rejection for same participant
    // ----------------------------------------------------
    await test("3. Second Spin from same participant is rejected with 403 ALREADY_SPUN", async () => {
      const res = await fetch(`${BASE_URL}/api/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": participant1Cookie,
          "Idempotency-Key": "different_key_2"
        },
        body: JSON.stringify({ idempotencyKey: "different_key_2" })
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, "ALREADY_SPUN");
      assert.ok(data.existingPrize);
    });

    // ----------------------------------------------------
    // Test 4: Idempotency Key replay
    // ----------------------------------------------------
    await test("4. Replaying identical Idempotency-Key returns original result without duplicate spin", async () => {
      const res = await fetch(`${BASE_URL}/api/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": participant1Cookie,
          "Idempotency-Key": "test_idemp_1"
        },
        body: JSON.stringify({ idempotencyKey: "test_idemp_1" })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.replayed, true);
      assert.strictEqual(data.promo.code, p1PromoCode);
    });

    // ----------------------------------------------------
    // Test 5: Concurrent Requests (Race Condition Defense)
    // ----------------------------------------------------
    await test("5. Concurrent Requests: 10 parallel requests yield exactly 1 spin and 9 rejections", async () => {
      const raceParticipantCookie = `gowash_pid=${crypto.randomUUID()}`;

      const requests = Array.from({ length: 10 }).map((_, i) =>
        fetch(`${BASE_URL}/api/spin`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cookie": raceParticipantCookie,
            "Idempotency-Key": `race_key_${i}`
          },
          body: JSON.stringify({ idempotencyKey: `race_key_${i}` })
        })
      );

      const responses = await Promise.all(requests);
      const results = await Promise.all(responses.map(r => r.json().then(body => ({ status: r.status, body }))));

      const successes = results.filter(r => r.status === 200 && r.body.success === true);
      const rejected = results.filter(r => r.status === 403 && r.body.code === 'ALREADY_SPUN');

      assert.strictEqual(successes.length, 1, `Expected exactly 1 success, got ${successes.length}`);
      assert.strictEqual(rejected.length, 9, `Expected exactly 9 rejections, got ${rejected.length}`);

      // Check DB count for this participant
      const pid = raceParticipantCookie.replace("gowash_pid=", "");
      const count = db.prepare("SELECT COUNT(*) as c FROM spins WHERE participant_id = ?").get(pid).c;
      assert.strictEqual(count, 1, "Database must contain exactly 1 spin record for participant");
    });

    // ----------------------------------------------------
    // Test 6: Campaign Paused & Kill Switch Blocks Spins
    // ----------------------------------------------------
    await test("6. Pausing campaign blocks new spins immediately with 400 CAMPAIGN_PAUSED", async () => {
      // Pause campaign in DB
      db.prepare("UPDATE campaign_settings SET status = 'PAUSED' WHERE id = 1").run();

      const newParticipantCookie = `gowash_pid=${crypto.randomUUID()}`;
      const res = await fetch(`${BASE_URL}/api/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": newParticipantCookie
        }
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, "CAMPAIGN_PAUSED");

      // Reactivate campaign
      db.prepare("UPDATE campaign_settings SET status = 'ACTIVE' WHERE id = 1").run();
    });

    // ----------------------------------------------------
    // Test 7: Admin Login, Authentication & Session Protection
    // ----------------------------------------------------
    let adminSessionCookie = "";
    let adminCsrfToken = "";

    await test("7. Unauthenticated admin access is blocked (401)", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/overview`);
      assert.strictEqual(res.status, 401);
    });

    await test("8. Admin login with bad password fails (401)", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong_password" })
      });
      assert.strictEqual(res.status, 401);
    });

    await test("9. Admin login with correct password succeeds and provides session + CSRF token", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "GoWash96@Admin" })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.csrfToken);
      adminCsrfToken = data.csrfToken;

      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get("set-cookie") || "").split(",");
      for (const sc of setCookies) {
        if (sc.includes("gowash_admin_session=")) {
          const match = sc.match(/gowash_admin_session=[^;]+/);
          if (match) adminSessionCookie = match[0];
        }
      }
      assert.ok(adminSessionCookie, "Must have gowash_admin_session cookie");
    });

    // ----------------------------------------------------
    // Test 10: Probability Validation in Admin
    // ----------------------------------------------------
    await test("10. Rejecting probability update if sum is not 100% or has invalid numbers", async () => {
      // 10a: Sum != 100% (e.g. 90%)
      const badPrizes = [
        { id: "discount_20", label: "20%", subtext: "x", probability: 20, is_active: 1 },
        { id: "discount_15", label: "15%", subtext: "x", probability: 20, is_active: 1 },
        { id: "discount_10", label: "10%", subtext: "x", probability: 20, is_active: 1 },
        { id: "discount_9_6", label: "9.6%", subtext: "x", probability: 10, is_active: 1 },
        { id: "discount_5", label: "5%", subtext: "x", probability: 10, is_active: 1 },
        { id: "signature_upgrade", label: "Signature", subtext: "x", probability: 10, is_active: 1 }
      ]; // Sum = 90%

      const res1 = await fetch(`${BASE_URL}/api/admin/prizes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        },
        body: JSON.stringify({ prizes: badPrizes })
      });

      assert.strictEqual(res1.status, 400);
      const data1 = await res1.json();
      assert.strictEqual(data1.success, false);
      assert.ok(data1.error.includes("100.00%"));

      // 10b: Negative number
      badPrizes[0].probability = -5;
      const res2 = await fetch(`${BASE_URL}/api/admin/prizes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        },
        body: JSON.stringify({ prizes: badPrizes })
      });
      assert.strictEqual(res2.status, 400);

      // 10c: Valid 100% update (15 + 25 + 30 + 19 + 10 + 1 = 100)
      const validPrizes = [
        { id: "discount_20", label: "20%", subtext: "خصم", probability: 15.0, is_active: 1 },
        { id: "discount_15", label: "15%", subtext: "خصم", probability: 25.0, is_active: 1 },
        { id: "discount_10", label: "10%", subtext: "خصم", probability: 30.0, is_active: 1 },
        { id: "discount_9_6", label: "9.6%", subtext: "خصم", probability: 19.0, is_active: 1 },
        { id: "discount_5", label: "5%", subtext: "خصم", probability: 10.0, is_active: 1 },
        { id: "signature_upgrade", label: "Signature", subtext: "ترقية", probability: 1.0, is_active: 1 }
      ];

      const res3 = await fetch(`${BASE_URL}/api/admin/prizes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        },
        body: JSON.stringify({ prizes: validPrizes })
      });
      assert.strictEqual(res3.status, 200);
      const data3 = await res3.json();
      assert.strictEqual(data3.success, true);
    });

    // ----------------------------------------------------
    // Test 11: Promo Code Redemption & Prevent Double-Use
    // ----------------------------------------------------
    await test("11. Promo Code single-use redemption and rejection on duplicate use", async () => {
      assert.ok(p1PromoCode, "p1PromoCode must exist");

      // First redemption: succeeds
      const res1 = await fetch(`${BASE_URL}/api/admin/promos/${p1PromoCode}/redeem`, {
        method: "POST",
        headers: {
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(res1.status, 200);
      const data1 = await res1.json();
      assert.strictEqual(data1.success, true);

      // Second redemption attempt: rejected
      const res2 = await fetch(`${BASE_URL}/api/admin/promos/${p1PromoCode}/redeem`, {
        method: "POST",
        headers: {
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(res2.status, 400);
      const data2 = await res2.json();
      assert.strictEqual(data2.success, false);
      assert.ok(data2.error.includes("مسبقاً"));
    });

    // ----------------------------------------------------
    // Test 12: Promo Code Cancellation
    // ----------------------------------------------------
    await test("12. Promo Code cancellation works and prevents future redemption", async () => {
      // Create a spin for a new participant to get a fresh code
      const freshCookie = `gowash_pid=${crypto.randomUUID()}`;
      const spinRes = await fetch(`${BASE_URL}/api/spin`, {
        method: "POST",
        headers: { "Cookie": freshCookie }
      });
      const spinData = await spinRes.json();
      const codeToCancel = spinData.promo.code;

      // Cancel code
      const cancelRes = await fetch(`${BASE_URL}/api/admin/promos/${codeToCancel}/cancel`, {
        method: "POST",
        headers: {
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(cancelRes.status, 200);

      // Try redeem cancelled code
      const redeemRes = await fetch(`${BASE_URL}/api/admin/promos/${codeToCancel}/redeem`, {
        method: "POST",
        headers: {
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(redeemRes.status, 400);
    });

    // ----------------------------------------------------
    // Test 13: CSRF Protection on Admin State Mutations
    // ----------------------------------------------------
    await test("13. State mutation without valid CSRF token is blocked with 403", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/kill-switch`, {
        method: "POST",
        headers: {
          "Cookie": adminSessionCookie,
          "x-csrf-token": "tampered_fake_token"
        }
      });
      assert.strictEqual(res.status, 403);
    });

    // ----------------------------------------------------
    // Test 14: Security Headers Check
    // ----------------------------------------------------
    await test("14. Security Headers (X-Content-Type-Options, X-Frame-Options, CSP) are present", async () => {
      const res = await fetch(`${BASE_URL}/`);
      assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
      assert.strictEqual(res.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.ok(res.headers.get("content-security-policy"));
      assert.strictEqual(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    });

    // ----------------------------------------------------
    // Test 15: Admin Overview Data Integrity
    // ----------------------------------------------------
    await test("15. Admin Overview returns accurate non-fake database counts", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/overview`, {
        headers: { "Cookie": adminSessionCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.stats.totalSpins >= 3);
      assert.ok(data.stats.uniqueParticipants >= 3);
      assert.ok(data.stats.rewardsIssued >= 3);
      assert.ok(data.stats.redeemedCodes >= 1);
    });

    // ----------------------------------------------------
    // Test 16: Admin Logout
    // ----------------------------------------------------
    await test("16. Admin logout terminates session successfully", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/logout`, {
        method: "POST",
        headers: {
          "Cookie": adminSessionCookie,
          "x-csrf-token": adminCsrfToken
        }
      });
      assert.strictEqual(res.status, 200);

      // Now session is invalid
      const checkRes = await fetch(`${BASE_URL}/api/admin/overview`, {
        headers: { "Cookie": adminSessionCookie }
      });
      assert.strictEqual(checkRes.status, 401);
    });

  } finally {
    server.close();
  }

  console.log("==================================================");
  console.log(`🏁 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
