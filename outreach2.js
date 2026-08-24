// Phase 5 Batch 2+: autonomous full-CSV processing with resumable progress.
const fs = require("fs");
const { sendMail } = require("./api/_mailer.js");

const LINK = "https://reviewreply-lilac.vercel.app";
const CSV = "/home/ubuntu/agent-ceo/research/raw/leads/osm_leads.csv";
const PROG = "/home/ubuntu/agent-ceo/research/raw/leads/batch_progress.json";

const doneBefore = new Set([
  "info@pausecafenyc.com","info@baalfelafel.com","info@senzaglutenbyjemiko.com",
  "info@lachulanyc.com","46thst@frankieandjohnnies.com","info@catchnchop.com",
  "allyoucaneat@wonderpigkbbq.com","sunnyside@doner.haus","info@tacubanyc.com",
  "safarinewyork2015@gmail.com",
]);

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (cell !== "" || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; } }
    else cell += c;
  }
  return rows.slice(1).filter(r => r.length >= 2);
}

const hookFor = (kind) => ({
  restaurant: "diners read recent reviews before choosing where to eat",
  cafe: "café regulars decide where to meet based on star ratings",
  fast_food: "the lunch crowd scans reviews before walking in",
  bakery: "bakeries live on word of mouth — and today that's review pages",
  bar: "nightlife choices run almost entirely on ratings",
  deli: "regulars find you through reviews before they ever walk past",
}[kind] || "locals check reviews before trying an independent spot");

(async () => {
  const prog = fs.existsSync(PROG) ? JSON.parse(fs.readFileSync(PROG)) : { sent: {}, log: [] };
  const sent = new Set([...doneBefore, ...Object.keys(prog.sent)]);
  const rows = parseCSV(fs.readFileSync(CSV, "utf8"));
  const queue = rows.map(([name, email, kind, city, site]) => ({ name, email: (email||"").trim(), kind, city }))
    .filter(l => l.name && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(l.email) && !sent.has(l.email.toLowerCase()));

  console.log("remaining to send:", queue.length);
  for (const [i, lead] of queue.entries()) {
    const cityBit = lead.city ? ` in ${lead.city}` : "";
    const body =
`Hi ${lead.name} team,

Running ${lead.kind || "a local business"}${cityBit}, ${hookFor(lead.kind)}. We built ReviewReply (${LINK}) to fix that: paste any review and get three polished, ready-to-post responses in seconds — free to try, no signup.

— John
ReviewReply · reply "no thanks" and I won't email again.`;
    try {
      await sendMail({
        host: process.env.SMTP_HOST || "oraforgetech.com",
        port: Number(process.env.SMTP_PORT || 465),
        user: process.env.WEBMAIL_USERNAME,
        pass: process.env.WEBMAIL_PASSWORD,
        from: process.env.WEBMAIL_USERNAME,
        to: lead.email,
        subject: `Quick idea for ${lead.name}'s review replies`,
        text: body,
        html: `<p>Hi ${lead.name} team,</p><p>Running ${lead.kind || "a local business"}${cityBit}, ${hookFor(lead.kind)}. We built <b>ReviewReply</b> (<a href="${LINK}">${LINK}</a>) to fix that: paste any review and get three polished, ready-to-post responses in seconds — free to try, no signup.</p><p>— John<br>ReviewReply · reply "no thanks" and I won't email again.</p>`,
      });
      prog.sent[lead.email.toLowerCase()] = new Date().toISOString();
      prog.log.push([lead.name, lead.email, "sent"]);
      console.log(`SENT (${i + 1}/${queue.length})`, lead.email);
    } catch (e) {
      prog.log.push([lead.name, lead.email, "failed:" + e.message.slice(0, 60)]);
      console.log(`FAIL`, lead.email, e.message.slice(0, 70));
    }
    fs.writeFileSync(PROG, JSON.stringify(prog, null, 1));
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log("BATCH RUN COMPLETE. total sent all-time:", new Set([...doneBefore, ...Object.keys(prog.sent)]).size);
})();
