// POST /api/webhook/kofi
// Ko-fi sends application/x-www-form-urlencoded with a single `data` field containing JSON.
// We validate verification_token against KOFI_VERIFICATION_TOKEN, derive the buyer's
// license key (stateless HMAC of their email), and email it to them via SMTP.
const querystring = require("querystring");
const { normalizeEmail, makeLicenseKey } = require("../_lib.js");
const { sendMail } = require("../_mailer.js");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error("body too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const raw = await readBody(req);
  const contentType = String(req.headers["content-type"] || "");
  let payload = {};
  try {
    if (contentType.includes("application/json")) {
      payload = JSON.parse(raw);
      if (typeof payload.data === "string") payload = JSON.parse(payload.data);
    } else {
      // Ko-fi default: form-urlencoded, data=<json>
      const parsed = querystring.parse(raw);
      payload = JSON.parse(Array.isArray(parsed.data) ? parsed.data[0] : parsed.data || "{}");
    }
  } catch (e) {
    return res.status(400).json({ error: "Unparseable data field" });
  }

  // --- Security: strict token validation ---
  const expected = process.env.KOFI_VERIFICATION_TOKEN || "";
  if (!expected || payload.verification_token !== expected) {
    return res.status(403).json({ error: "Invalid verification token" });
  }

  const type = String(payload.type || "Donation");
  const amount = parseFloat(String(payload.amount || "0")) || 0;
  const minAmount = parseFloat(process.env.KOFI_MIN_AMOUNT || "3");
  if (amount < minAmount) {
    return res.status(200).json({ ok: true, note: `amount ${amount} below unlock threshold` });
  }

  const email = normalizeEmail(payload.email);
  if (!email.includes("@")) {
    return res.status(200).json({ ok: true, note: "no buyer email present" });
  }

  const key = makeLicenseKey(email);
  const name = String(payload.from_name || "there").slice(0, 60);
  const appUrl = process.env.APP_URL || "";
  const activateUrl = `${appUrl}/success.html?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`;

  const text = [
    `Hi ${name},`,
    ``,
    `Thank you for upgrading to ReviewReply Pro ($${amount.toFixed(2)}, ${type}).`,
    ``,
    `Your license key:  ${key}`,
    `Licensed to:       ${email}`,
    ``,
    `Activate in two steps:`,
    `1. Open ${activateUrl || appUrl}`,
    `2. Enter your email (${email}) and the key above.`,
    ``,
    `Pro unlocks: unlimited review replies, saved history, one-click export, extra tones, and multi-language replies.`,
    ``,
    `Didn't expect this or need help? Just reply to this email.`,
    ``,
    `- ReviewReply`,
  ].join("\n");

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1a2233">`,
    `<h2 style="margin-bottom:4px">You're Pro now 🎉</h2>`,
    `<p style="color:#44506b">Thanks for upgrading to <b>ReviewReply Pro</b> ($${amount.toFixed(2)}, ${type}).</p>`,
    `<div style="background:#f4f6fb;border:1px solid #dbe2f0;border-radius:10px;padding:16px;margin:18px 0">`,
    `  <div style="font-size:12px;color:#68758f;text-transform:uppercase;letter-spacing:.08em">License key</div>`,
    `  <div style="font-size:24px;font-weight:700;letter-spacing:.06em;margin-top:6px">${key}</div>`,
    `  <div style="font-size:12px;color:#68758f;margin-top:6px">Licensed to ${email}</div>`,
    `</div>`,
    `<p><a href="${activateUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Activate Pro</a></p>`,
    `<p style="color:#68758f;font-size:14px">Or open <code>${appUrl}/success.html</code> and enter your email + key.</p>`,
    `<p style="color:#98a3ba;font-size:13px">Questions? Reply to this email — a human reads it.</p>`,
    `</div>`,
  ].join("");

  try {
    await sendMail({
      host: process.env.SMTP_HOST || "oraforgetech.com",
      port: process.env.SMTP_PORT || 465,
      user: process.env.WEBMAIL_USERNAME,
      pass: process.env.WEBMAIL_PASSWORD,
      from: process.env.WEBMAIL_USERNAME,
      to: email,
      subject: "Your ReviewReply Pro license key",
      text,
      html,
    });
    return res.status(200).json({ ok: true, emailed: true });
  } catch (e) {
    console.error("license mail failed:", e.message);
    // Token was valid — acknowledge so Ko-fi doesn't retry forever; key is re-derivable
    // deterministically and support can resend manually.
    return res.status(200).json({ ok: true, emailed: false });
  }
};
