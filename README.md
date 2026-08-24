# ReviewReply

AI-powered Google review reply generator for small businesses. Paste a review, get three
polished, ready-to-post responses. Free tier: 3/day. Pro: $19 one-time (Ko-fi).

## Architecture (zero-dependency)

- **Static frontend** — `index.html` (landing + tool), `pricing.html`, `success.html`
  (activation). Vanilla HTML/CSS/JS, no build step.
- **Serverless API** (Vercel functions):
  - `POST /api/generate` — {reviewText, businessName?, license?} → 3 replies.
    Free tier rate-limited (3/day/IP) on a free OpenRouter model; Pro verified statelessly.
  - `POST /api/webhook/kofi` — Ko-fi payments webhook. Parses `application/x-www-form-urlencoded`
    body, extracts the JSON `data` field, validates `verification_token` against
    `$KOFI_VERIFICATION_TOKEN`, derives the buyer's license key, and emails it via SMTP.
  - `POST /api/activate` — {email, key} → stateless HMAC validation → unlock Pro.
- **Licensing** — fully stateless. `key = HMAC_SHA256(normalized_email, LICENSE_SECRET)[:10]`.
  No database anywhere. Losing the email = reply to it for a resend.
- **Email** — hand-rolled minimal SMTP client over implicit TLS (`api/_mailer.js`), no npm deps.

## Environment variables (server-side only)

| Var | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | LLM access |
| `KOFI_VERIFICATION_TOKEN` | Ko-fi webhook validation + default license secret |
| `LICENSE_SECRET` | optional override for HMAC secret |
| `WEBMAIL_USERNAME` / `WEBMAIL_PASSWORD` | SMTP credentials |
| `SMTP_HOST` / `SMTP_PORT` | defaults: oraforgetech.com:465 |
| `APP_URL` | public https URL, used in license emails |
| `FREE_MODEL` / `PRO_MODEL` | OpenRouter model ids |

## Ko-fi setup

In Ko-fi dashboard → Settings → API/Webhooks:
enable webhooks and set the endpoint to `https://<your-domain>/api/webhook/kofi`.
Ko-fi POSTs `application/x-www-form-urlencoded` with a `data` field containing JSON
(including `verification_token`, buyer `email`, `amount`, `type`). Any payment ≥ $3 unlocks Pro.

## Local test

```bash
bash test_local.sh   # runs all functions against REAL OpenRouter + SMTP with mocked req/res
```
