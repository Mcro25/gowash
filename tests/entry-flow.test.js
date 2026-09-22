process.env.NODE_ENV = 'test';
const assert = require('node:assert');
const crypto = require('node:crypto');
const app = require('../server');
const db = require('../src/db');

const TEST_PORT = 3198;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;

async function runEntryFlowTests() {
  console.log("==================================================");
  console.log("🚀 Running Event Entry Flow & Validation Tests");
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

  try {
    await new Promise(resolve => {
      server = app.listen(TEST_PORT, () => resolve());
    });

    // Test 1: Validation - Reject short/invalid name
    await test("1. Entry endpoint rejects name with less than 2 characters", async () => {
      const pid = crypto.randomUUID();
      const res = await fetch(`${BASE_URL}/api/participant/entry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `gowash_pid=${pid}`
        },
        body: JSON.stringify({
          name: "أ",
          phone: "0512345678"
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.ok(data.error.includes("حرفين"));
    });

    // Test 2: Validation - Reject invalid phone numbers
    await test("2. Entry endpoint rejects invalid phone numbers", async () => {
      const invalidPhones = ["12345", "0612345678", "051234567", "051234567890", "abcd0512345678"];
      for (const badPhone of invalidPhones) {
        const pid = crypto.randomUUID();
        const res = await fetch(`${BASE_URL}/api/participant/entry`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cookie": `gowash_pid=${pid}`
          },
          body: JSON.stringify({
            name: "أحمد محمد",
            phone: badPhone
          })
        });
        const data = await res.json();
        assert.strictEqual(res.status, 400);
        assert.strictEqual(data.success, false);
        assert.ok(data.error.includes("جوال") || data.error.includes("سعودي"));
      }
    });

    // Test 3: Normalization - Accepts various valid Saudi phone formats
    await test("3. Entry endpoint normalizes Saudi phones (+966, 966, 00966, 5, 05)", async () => {
      const validFormats = [
        "0581112233",
        "+966581112234",
        "00966581112235",
        "966581112236",
        "581112237"
      ];

      for (const ph of validFormats) {
        const pid = crypto.randomUUID();
        const res = await fetch(`${BASE_URL}/api/participant/entry`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cookie": `gowash_pid=${pid}`
          },
          body: JSON.stringify({
            name: "سعود العتيبي",
            phone: ph
          })
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.alreadyParticipated, false);
        assert.ok(data.participant.phone.startsWith("05"));
      }
    });

    // Test 4: End-to-end Entry -> Spin -> Win
    const testPhone = "05" + Math.floor(10000000 + Math.random() * 90000000);
    let testPid = crypto.randomUUID();
    let wonPrizeCode = null;

    await test("4. New participant registers -> executes spin -> receives prize", async () => {
      // Step A: Entry
      const entryRes = await fetch(`${BASE_URL}/api/participant/entry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `gowash_pid=${testPid}`
        },
        body: JSON.stringify({
          name: "خالد بن عبدالعزيز",
          phone: testPhone
        })
      });
      const entryData = await entryRes.json();
      assert.strictEqual(entryRes.status, 200);
      assert.strictEqual(entryData.success, true);
      assert.strictEqual(entryData.alreadyParticipated, false);

      // Step B: Consent
      const consentRes = await fetch(`${BASE_URL}/api/consent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `gowash_pid=${testPid}`
        },
        body: JSON.stringify({
          termsAccepted: true,
          termsVersion: "1.1",
          name: "خالد بن عبدالعزيز",
          phone: testPhone
        })
      });
      const consentData = await consentRes.json();
      assert.strictEqual(consentRes.status, 200);
      assert.strictEqual(consentData.success, true);

      // Step C: Spin
      const spinRes = await fetch(`${BASE_URL}/api/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `gowash_pid=${testPid}`
        },
        body: JSON.stringify({
          termsAccepted: true,
          termsVersion: "1.1",
          name: "خالد بن عبدالعزيز",
          phone: testPhone
        })
      });
      const spinData = await spinRes.json();
      assert.strictEqual(spinRes.status, 200);
      assert.strictEqual(spinData.success, true);
      assert.ok(spinData.prize);
      assert.ok(spinData.promo && spinData.promo.code);
      wonPrizeCode = spinData.promo.code;
    });

    // Test 5: Duplicate Phone on Entry Screen returns alreadyParticipated: true
    await test("5. Duplicate phone entry returns alreadyParticipated: true with existing prize", async () => {
      const newPid = crypto.randomUUID(); // Different device / session
      const res = await fetch(`${BASE_URL}/api/participant/entry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `gowash_pid=${newPid}`
        },
        body: JSON.stringify({
          name: "خالد عبدالعزيز",
          phone: testPhone // Same phone
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.alreadyParticipated, true);
      assert.ok(data.existingPrize);
      assert.strictEqual(data.existingPrize.code, wonPrizeCode);
      // Ensure phone is masked in participant details
      assert.ok(data.existingPrize.participant.phone.includes("••••") || data.existingPrize.participant.phone.includes("****"));
    });

    // Test 6: Duplicate Phone cannot spin again
    await test("6. Participant with duplicate phone cannot spin again", async () => {
      const newPid = crypto.randomUUID();
      const res = await fetch(`${BASE_URL}/api/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `gowash_pid=${newPid}`
        },
        body: JSON.stringify({
          termsAccepted: true,
          termsVersion: "1.1",
          name: "خالد محاولة ثانية",
          phone: testPhone
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, "ALREADY_SPUN");
      assert.ok(data.existingPrize);
      assert.strictEqual(data.existingPrize.code, wonPrizeCode);
    });

    // Test 7: Phone Masking in check-prize and my-result
    await test("7. Privacy: check-prize and my-result mask participant phone numbers", async () => {
      // check-prize
      const checkRes = await fetch(`${BASE_URL}/api/check-prize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone })
      });
      const checkData = await checkRes.json();
      assert.ok((checkData.participant.maskedPhone || checkData.participant.phone).includes("••••") || (checkData.participant.maskedPhone || checkData.participant.phone).includes("****"));

      // my-result
      const myRes = await fetch(`${BASE_URL}/api/my-result`, {
        method: "GET",
        headers: { "Cookie": `gowash_pid=${testPid}` }
      });
      const myData = await myRes.json();
      assert.strictEqual(myRes.status, 200);
      assert.strictEqual(myData.success, true);
      assert.ok((myData.participant.maskedPhone || myData.participant.phone).includes("••••") || (myData.participant.maskedPhone || myData.participant.phone).includes("****"));
    });

    console.log("==================================================");
    console.log(`Summary: ${passed} Passed, ${failed} Failed`);
    console.log("==================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    if (server) {
      server.close();
    }
  }
}

runEntryFlowTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
