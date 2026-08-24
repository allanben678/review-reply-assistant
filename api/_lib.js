// Shared helpers for ReviewReply API functions.
// Secrets come exclusively from environment variables (set in Vercel dashboard/CLI).
const crypto = require("crypto");

const LICENSE_SECRET =
  process.env.LICENSE_SECRET || process.env.KOFI_VERIFICATION_TOKEN || "";

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

// Deterministic, stateless license key derived from the buyer's email.
// Only someone holding LICENSE_SECRET can mint or validate keys.
function makeLicenseKey(emailRaw) {
  const email = normalizeEmail(emailRaw);
  const hmac = crypto.createHmac("sha256", LICENSE_SECRET).update(email).digest("hex");
  const core = hmac.slice(0, 10).toUpperCase();
  return `RR-${core.slice(0, 5)}-${core.slice(5, 10)}`;
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isValidLicense(emailRaw, keyRaw) {
  if (!LICENSE_SECRET) return false;
  const email = normalizeEmail(emailRaw);
  const key = String(keyRaw || "").trim().toUpperCase();
  if (!email.includes("@") || !/^RR-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key)) return false;
  return timingSafeEqualStr(makeLicenseKey(email), key);
}

// --- Minimal in-memory rate limiting (per warm instance; resets on cold start).
const rlMap = new Map();
function dayKey() {
  return new Date().toISOString().slice(0, 10);
}
function hitLimit(ip, maxPerDay) {
  const d = dayKey();
  const rec = rlMap.get(ip);
  if (!rec || rec.day !== d) {
    rlMap.set(ip, { day: d, count: 1 });
    return { limited: false, remaining: maxPerDay - 1 };
  }
  rec.count += 1;
  if (rec.count > maxPerDay) return { limited: true, remaining: 0 };
  return { limited: false, remaining: maxPerDay - rec.count };
}
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"] || "";
  return String(fwd).split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

module.exports = {
  normalizeEmail,
  makeLicenseKey,
  isValidLicense,
  timingSafeEqualStr,
  hitLimit,
  clientIp,
};
