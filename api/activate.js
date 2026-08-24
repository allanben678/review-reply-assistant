// POST /api/activate  { email, key } -> { ok, plan }
// Stateless check: key must equal HMAC(email, LICENSE_SECRET).
const { isValidLicense } = require("./_lib.js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; }
  catch (_) { return res.status(400).json({ error: "Bad JSON" }); }

  const ok = isValidLicense(body.email, body.key);
  if (!ok) return res.status(200).json({ ok: false, error: "Email and key don't match. Check the license email." });

  return res.status(200).json({ ok: true, plan: "pro" });
};
