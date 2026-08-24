// Phase 5 outreach: personalized 2-sentence cold pitches via existing SMTP client.
const { sendMail } = require("./api/_mailer.js");

const LINK = "https://reviewreply-lilac.vercel.app";
const leads = [
  ["Pause Cafe","info@pausecafenyc.com","a Manhattan café","café regulars decide where to study or meet based on your star rating"],
  ["Ba'al Cafe & Falafel","info@baalfelafel.com","a NYC falafel spot","one unanswered complaint about a lunch rush can scare off dozens of nearby office workers"],
  ["Senza Gluten by Jemiko","info@senzaglutenbyjemiko.com","a gluten-free restaurant","diners with celiac needs read every single review before booking"],
  ["La Chula","info@lachulanyc.com","a Mexican restaurant in Midtown","tourists pick tacos by star rating alone"],
  ["Frankie and Johnie's Steakhouse","46thst@frankieandjohnnies.com","a Manhattan steakhouse","steakhouse tickets are big-ticket decisions driven heavily by recent reviews"],
  ["Catch n' Chop","info@catchnchop.com","a seafood restaurant","freshness complaints left unanswered can sink a seafood brand fast"],
  ["Wonder Pig K-BBQ","allyoucaneat@wonderpigkbbq.com","an all-you-can-eat K-BBQ spot","K-BBQ fans compare reviews across ten options before choosing"],
  ["Döner Haus","sunnyside@doner.haus","Sunnyside's Döner Haus","locals check recent reviews before trying a new kebab place"],
  ["Tacuba","info@tacubanyc.com","Tacuba","your happy hour crowd is reading last week's reviews right now"],
  ["Safari","safarinewyork2015@gmail.com","Harlem's Safari restaurant","Harlem diners have plenty of choices and thin margins for bad first impressions"],
];

(async () => {
  const results = [];
  for (const [name, email, desc, hook] of leads) {
    const body =
`Hi ${name} team,

Running ${desc}, ${hook}. We built ReviewReply (${LINK}) to fix that: paste any review and get three polished, ready-to-post responses in seconds — free to try, no signup.

— John
ReviewReply · reply "no thanks" and I won't email again.`;
    try {
      await sendMail({
        host: process.env.SMTP_HOST || "oraforgetech.com",
        port: Number(process.env.SMTP_PORT || 465),
        user: process.env.WEBMAIL_USERNAME,
        pass: process.env.WEBMAIL_PASSWORD,
        from: process.env.WEBMAIL_USERNAME,
        to: email,
        subject: `Quick idea for ${name}'s review replies`,
        text: body,
        html: `<p>Hi ${name} team,</p><p>Running ${desc}, ${hook}. We built <b>ReviewReply</b> (<a href="${LINK}">${LINK}</a>) to fix that: paste any review and get three polished, ready-to-post responses in seconds — free to try, no signup.</p><p>— John<br>ReviewReply · reply “no thanks” and I won’t email again.</p>`,
      });
      console.log("SENT", email);
      results.push([name, email, "sent"]);
    } catch (e) {
      console.log("FAIL", email, e.message.slice(0, 80));
      results.push([name, email, "failed: " + e.message.slice(0, 60)]);
    }
    await new Promise((r) => setTimeout(r, 4000)); // gentle pace
  }
  require("fs").writeFileSync("/home/ubuntu/agent-ceo/research/raw/leads/send_results.json",
    JSON.stringify(results, null, 1));
})();
