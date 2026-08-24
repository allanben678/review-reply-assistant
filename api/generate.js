// POST /api/generate  { reviewText, businessName?, license?: {email, key} }
// Free tier: 3 review-sets/day/IP on a free model.
// Pro (valid license): unlimited, premium model.
const { isValidLicense, hitLimit, clientIp } = require("./_lib.js");

const FREE_MODEL = process.env.FREE_MODEL || "google/gemini-2.5-flash-lite";
const FREE_FALLBACK = "openai/gpt-5-nano";
const PRO_MODEL = process.env.PRO_MODEL || "google/gemini-3.7-flash";
const FREE_DAILY_LIMIT = 3;
const ANON_INSTANCE_CAP = 400; // global per-instance safety cap

const anonCounter = { day: null, count: 0 };

function systemPrompt(businessName) {
  const biz = businessName ? `"${businessName}"` : "the business";
  return [
    "You are an expert online-reputation manager who writes public replies to customer reviews.",
    `You are replying on behalf of ${biz}.`,
    "Rules for every reply:",
    "- Sound like a real, caring human owner/manager. Never mention AI.",
    "- Acknowledge the specific points the reviewer raised; never use generic filler only.",
    "- Stay professional and calm even when the review is unfair or angry; never argue or blame the customer.",
    "- For negative reviews: apologize for their experience, address the core issue briefly, and invite them to continue offline (email/phone).",
    "- For positive reviews: thank them warmly and reinforce what they loved.",
    "- 2 to 4 sentences each. Plain text only. No markdown, no bullet lists, no emoji.",
    '- Sign off with "— The Team at ' + (businessName || "[Business Name]") + '" only if it fits naturally; otherwise no signature.',
    'Return STRICT JSON: {"replies":[{"label":"Professional","text":"..."},{"label":"Empathetic","text":"..."},{"label":"Brief","text":"..."}]}',
    "The Professional reply is polished and neutral. The Empathetic reply leads with genuine care. The Brief reply is short and confident.",
  ].join(" ");
}

async function callOpenRouter(model, system, userText, maxTokens = 1000, tries = 2) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://reviewreply.vercel.app",
        "X-Title": "ReviewReply",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
      }),
    });
    if (res.ok) return (await res.json()).choices?.[0]?.message?.content || "";
    const t = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      await new Promise((r) => setTimeout(r, 700 * attempt));
      continue;
    }
    throw new Error(`openrouter ${res.status}: ${t.slice(0, 200)}`);
  }
  throw new Error("openrouter exhausted retries");
}

function parseReplies(raw) {
  let s = String(raw || "").trim();
  // strip markdown fences
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  // unwrap double-encoded JSON strings: "\"{\\\"replies\\\"...}\""
  for (let i = 0; i < 2 && s.startsWith('"') && s.endsWith('"'); i++) {
    try {
      const inner = JSON.parse(s);
      if (typeof inner === "string") {
        s = inner.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
        continue;
      }
      s = typeof inner === "object" ? JSON.stringify(inner) : s;
    } catch (_) {}
    break;
  }
  const candidates = [s];
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(s.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (Array.isArray(obj.replies)) {
        let arr = obj.replies;
        // nested once more: replies:[ "{...}" ] or replies:{...}
        if (arr.length === 1 && typeof arr[0] === "string") {
          try { const o2 = JSON.parse(arr[0]); if (o2.replies) arr = o2.replies; } catch (_) {}
        }
        if (!Array.isArray(arr) && typeof arr === "object") arr = Object.values(arr);
        const cleaned = arr
          .map((r) => (typeof r === "string" ? (() => { try { return JSON.parse(r); } catch (_) { return null; } })() : r))
          .filter((r) => r && typeof r.text === "string" && r.text.trim())
          .map((r) => ({ label: String(r.label || "Reply"), text: r.text.trim() }));
        if (cleaned.length >= 2) return cleaned.slice(0, 3);
        if (cleaned.length === 1) return cleaned;
      }
    } catch (_) {}
  }
  // Salvage from truncated JSON: extract any complete label/text pairs.
  const salvaged = [];
  const re = /"label"\s*:\s*"([^"]{0,40})"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m2;
  while ((m2 = re.exec(s)) !== null) {
    const text = m2[2]
      .replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      .trim();
    if (text.length > 20) salvaged.push({ label: m2[1] || "Reply", text });
  }
  if (salvaged.length >= 1) return salvaged.slice(0, 3);
  // Fallback: split on labels like "Professional: ..."
  const parts = s.split(/(?=(?:Professional|Empathetic|Brief)\s*:)/i).filter((p) => p.trim().length > 20);
  if (parts.length >= 2) {
    return parts.slice(0, 3).map((p, i) => {
      const m = p.match(/^\s*(Professional|Empathetic|Brief)\s*:\s*/i);
      return { label: m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : ["Professional", "Empathetic", "Brief"][i], text: p.replace(m ? m[0] : "", "").trim() };
    });
  }
  console.error("parse degraded; raw head:", s.slice(0, 160).replace(/\n/g, "\\n"));
  return [{ label: "Suggested reply", text: s.replace(/^[{\[]+|[\}\]]+$/g, "").slice(0, 1200) }];
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; }
  catch (_) { return res.status(400).json({ error: "Bad JSON" }); }

  const reviewText = String(body.reviewText || "").trim();
  const businessName = String(body.businessName || "").slice(0, 80);
  if (reviewText.length < 10 || reviewText.length > 2500) {
    return res.status(400).json({ error: "Review must be 10–2500 characters." });
  }

  const pro = body.license ? isValidLicense(body.license.email, body.license.key) : false;

  let remaining = null;
  if (!pro) {
    const d = new Date().toISOString().slice(0, 10);
    if (anonCounter.day !== d) { anonCounter.day = d; anonCounter.count = 0; }
    if (++anonCounter.count > ANON_INSTANCE_CAP) {
      return res.status(429).json({ error: "Free capacity reached for now — please try again later." });
    }
    const rl = hitLimit(clientIp(req), FREE_DAILY_LIMIT);
    if (rl.limited) {
      return res.status(429).json({
        error: "You've used all 3 free replies today. Upgrade to Pro for unlimited replies.",
        upgrade: true,
        remaining: 0,
      });
    }
    remaining = rl.remaining;
  }

  const userText =
    `Write the three replies now.\n` +
    (businessName ? `Business name: ${businessName}\n` : "") +
    `Review text:\n"""${reviewText}"""`;

  const model = pro ? PRO_MODEL : FREE_MODEL;
  let raw;
  try {
    raw = await callOpenRouter(model, systemPrompt(businessName), userText, pro ? 1600 : 1000);
  } catch (e1) {
    console.error("generate failed model=", model, "err:", e1.message);
    if (!pro) {
      try { raw = await callOpenRouter(FREE_FALLBACK, systemPrompt(businessName), userText, 1000); }
      catch (e2) {
        console.error("fallback failed err:", e2.message);
        return res.status(502).json({ error: "Generation failed, please retry." });
      }
    } else {
      return res.status(502).json({ error: "Generation failed, please retry." });
    }
  }

  return res.status(200).json({ replies: parseReplies(raw), plan: pro ? "pro" : "free", remaining });
};
