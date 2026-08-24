#!/usr/bin/env bash
# Local end-to-end test harness: runs serverless functions with mocked req/res
# against REAL services (OpenRouter, SMTP). Loads env from ~/agent-ceo/.env
set -euo pipefail
cd "$(dirname "$0")"
set -a; source "$HOME/agent-ceo/.env"; set +a
export KOFI_VERIFICATION_TOKEN OPENROUTER_API_KEY WEBMAIL_USERNAME WEBMAIL_PASSWORD
export APP_URL="http://localhost:3000"

node - <<'EOF'
const assert = require("assert");

function mockRes() {
  return {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; console.log(`  <- ${this.statusCode}`, JSON.stringify(o).slice(0, 220)); return this; },
    end() { console.log(`  <- ${this.statusCode} (end)`); },
  };
}
function mockReq(method, body, headers = {}) {
  const h = { "content-type": "application/json", ...headers };
  return { method, headers: h, body,
    on(ev, cb) { if (ev === "data") cb(Buffer.from(JSON.stringify(body))); if (ev === "end") cb(); },
    socket: { remoteAddress: "127.0.0.1" } };
}

(async () => {
  // ---------- 1. activate: bad key rejected ----------
  let activate = require("./api/activate.js");
  console.log("\n[1] activate with WRONG key");
  let res = mockRes(); await activate(mockReq("POST", { email: "john@oraforgetech.com", key: "RR-AAAAA-BBBBB" }), res);
  assert.strictEqual(res.body.ok, false);

  // ---------- 2. license derivation consistency ----------
  const { makeLicenseKey, isValidLicense } = require("./api/_lib.js");
  const key = makeLicenseKey("John@Example.com ");
  console.log("\n[2] derived key:", key);
  assert.ok(/^RR-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key));
  assert.ok(isValidLicense("JOHN@example.com", key), "case/space-insensitive validation");
  assert.ok(!isValidLicense("someone-else@x.com", key));

  // ---------- 3. webhook: invalid token -> 403 ----------
  let kofi = require("./api/webhook/kofi.js");
  console.log("\n[3] webhook INVALID token");
  res = mockRes();
  const badBody = "data=" + encodeURIComponent(JSON.stringify({ verification_token: "WRONG", email: "x@y.com", amount: "19" }));
  await kofi(mockReq("POST", null, { "content-type": "application/x-www-form-urlencoded" }), res);
  // need raw body override:
  function mockRawReq(raw, ct) {
    return { method: "POST", headers: { "content-type": ct },
      on(ev, cb) { if (ev === "data") cb(Buffer.from(raw)); if (ev === "end") cb(); },
      socket: { remoteAddress: "127.0.0.1" } };
  }
  res = mockRes();
  await kofi(mockRawReq(badBody, "application/x-www-form-urlencoded"), res);
  assert.strictEqual(res.statusCode, 403);

  // ---------- 4. webhook: VALID token -> sends real email ----------
  console.log("\n[4] webhook VALID token (real Ko-fi format) -> real SMTP send");
  const payload = {
    message_id: "test_" + Date.now(),
    timestamp: new Date().toISOString(),
    type: "Donation",
    is_public: true,
    from_name: "John",
    email: process.env.WEBMAIL_USERNAME,
    currency: "USD",
    amount: "19.00",
    url: "https://ko-fi.com/",
    transaction_id: "TEST-" + Date.now(),
    verification_token: process.env.KOFI_VERIFICATION_TOKEN,
  };
  const goodBody = "data=" + encodeURIComponent(JSON.stringify(payload)) + "&source=widget";
  res = mockRes();
  await kofi(mockRawReq(goodBody, "application/x-www-form-urlencoded"), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.emailed, true);

  // ---------- 5. generate: free tier, real OpenRouter call ----------
  let generate = require("./api/generate.js");
  console.log("\n[5] generate (free tier, real OpenRouter)");
  res = mockRes();
  await generate(mockReq("POST", {
    reviewText: "Waited 40 minutes even with a reservation. Food was decent but service ruined our anniversary dinner. Staff didn't seem to care at all.",
    businessName: "Bella Vista Trattoria",
  }, { "x-forwarded-for": "203.0.113.7" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.replies) && res.body.replies.length >= 3, "3 replies returned");
  console.log("   sample reply [0]:", res.body.replies[0].text.slice(0, 140));

  console.log("\n✅ ALL LOCAL TESTS PASSED");
})().catch(e => { console.error("\n❌ TEST FAILED:", e.message); process.exit(1); });
EOF