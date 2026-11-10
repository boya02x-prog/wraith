# Wraith — environment setup, from zero

Put everything in `.env.local` (never commit it). `.env.example` is the template. After editing, **restart `npm run dev`**.
On Vercel: Project → Settings → Environment Variables → add the same keys → redeploy.
Anything starting with `NEXT_PUBLIC_` is visible in the browser — never put a secret there.

Order below = what to set up first.

---
## 1. Helius (RPC + candles + swaps) — REQUIRED
1. Go to https://dashboard.helius.dev and sign up.
2. Dashboard → **API Keys** → copy your key (or **RPCs** → Mainnet URL).
3. `SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key>`. Server-only: never give a keyed URL a `NEXT_PUBLIC_` prefix, because Next.js ships those to every browser that loads the site.
4. Optional devnet (test mode): `https://devnet.helius-rpc.com/?api-key=<key>` → `DEVNET_RPC_URL`.
5. Optional: `SOLANA_RPC_URLS=https://a,https://b` adds extra keyed endpoints that are tried in order when the first one rate-limits.
Wraith reads the API key from that URL for the Enhanced Transactions API (swaps, chart candles) and DAS (holder counts). No separate key needed.
Free plan is fine for dev; upgrade when users grow.

## 2. MongoDB Atlas — REQUIRED
1. https://cloud.mongodb.com → create a free **M0** cluster.
2. **Database Access** → Add user (username + password). Avoid special characters in the password, or URL-encode them.
3. **Network Access** → Add IP: your IP for dev; `0.0.0.0/0` for Vercel (Vercel IPs change).
4. **Connect → Drivers** → copy the `mongodb+srv://…` string, replace `<password>`.
5. `MONGODB_URI=<that string>`, `MONGODB_DB=wraith`.

## 3. Privy — REQUIRED (login + embedded wallets)
1. https://dashboard.privy.io → **Create app** (web).
2. **Settings → Basics**: copy **App ID** → `NEXT_PUBLIC_PRIVY_APP_ID`; **App secret** → `PRIVY_APP_SECRET`.
3. **Settings → Domains / Allowed origins**: add `http://localhost:3000` and your production domain (missing origin = login fails).
4. **Embedded wallets**: enable, turn on Solana (+ EVM chains you use), create on login.
5. Login methods: enable email / Google / X / wallet as you like.
(Wraith hides Privy's confirm popup in code — no dashboard setting needed.)

## 4. Jupiter — REQUIRED for Solana swaps
1. https://portal.jup.ag → sign in → **API Keys** → create.
2. `JUPITER_API_KEY=<key>`.
Fee wallet is hardcoded in `lib/tiers.ts` and `app/api/jupiter/route.ts` (not an env var). Change it there.
LI.FI (cross-chain): works without a key. Optional key at https://li.fi → `LIFI_API_KEY`.

## 5. Upstash Redis — RECOMMENDED
1. https://console.upstash.com → **Create Database** (Redis, region near your Vercel region).
2. Open it → **REST API** section → copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## 6. AI (token analysis + story scan) — RECOMMENDED
All AI calls go through `lib/ai.ts`: **Gemini first, Groq as free backup**. One key is enough.
- **Gemini (free):** https://aistudio.google.com/apikey → Create API key → `GEMINI_API_KEY`. The code now uses Google's current Flash models (`gemini-3.8-flash`, falls back to older ones automatically). Override with `GEMINI_MODEL` if Google renames it.
- **Groq (free backup, optional):** https://console.groq.com/keys → Create API key → `GROQ_API_KEY`. Uses `openai/gpt-oss-120b` (free plan is small: ~30 req/min, 8K tokens/min), only used when Gemini is rate-limited or down.
- **Web-grounded analysis:** Google Search grounding is not on Google's free tier. Without it the analysis tells the user the viral origin is unverified instead of guessing. With a paid Google key set `GEMINI_SEARCH=1` to turn it on.

## 7. Birdeye — OPTIONAL fallback
https://bds.birdeye.so → sign in → API key → `BIRDEYE_API_KEY`. Helius is primary now; skip if you want.

## 8. Social scanning
- **Twitter/X bearer** (`TWITTER_BEARER_TOKEN`): https://developer.x.com → create project + app → **Keys and tokens** → Bearer Token. Needs a paid tier for search.
- **Reddit** (`REDDIT_USER_AGENT`): no key; just a descriptive string, e.g. `wraith-scanner/1.0 (by u/yourname)`.
- **Telegram channel scan** (`TELEGRAM_RSS_BASE`): defaults to `https://rsshub.app/telegram/channel` (public, rate-limited). Self-host RSSHub for reliability and set your own base URL.

## 9. Telegram bot + alerts — when you launch the bot
Only **one** value comes from BotFather. The other three are passwords you invent (random strings) — generated for you in `.env.local`.
| Variable | Where it comes from | What it does |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather → your bot → API token | Lets Wraith send messages as the bot |
| `TELEGRAM_BOT_USERNAME` | The bot's username from BotFather, without `@` | Builds the "open the bot" links |
| `TELEGRAM_WEBHOOK_SECRET` | You invent it | Telegram attaches it to every message it sends to `/api/telegram/bot`; the route rejects anything without it, so nobody can fake bot messages |
| `TELEGRAM_SETUP_KEY` | You invent it | Password for the one-time page `/api/telegram/setup?key=…` that registers the webhook, so strangers can't re-point your bot |
| `CRON_SECRET` | You invent it | Password for `/api/cron/tg-alerts` so only Vercel/your cron can trigger the alert run |
Random string (PowerShell): `-join ((48..57)+(97..122) | Get-Random -Count 40 | % {[char]$_})`
Steps (after you deploy; the webhook needs a public https URL):
1. Put all four in Vercel env vars, redeploy.
2. Open once: `https://your-domain/api/telegram/setup?key=<TELEGRAM_SETUP_KEY>` → registers the webhook.
3. Alerts: Vercel Hobby crons run at most once a day, so for frequent alerts use a free external cron (e.g. cron-job.org) calling `https://your-domain/api/cron/tg-alerts?key=<CRON_SECRET>` every few minutes.
4. `NEXT_PUBLIC_TELEGRAM_URL` = your public channel/group link (footer).

## 10. X account linking — OPTIONAL
1. https://developer.x.com → your app → **User authentication settings** → OAuth 2.0, type "Web App".
2. Callback URL: the one your app uses (see the profile page text) e.g. `https://your-domain/api/user/x-account/callback` (+ localhost version for dev).
3. Copy Client ID / Secret → `X_OAUTH_CLIENT_ID`, `X_OAUTH_CLIENT_SECRET`; set `X_OAUTH_CALLBACK_URL` to the exact same callback.

## 11. App URL — REQUIRED in production
`NEXT_PUBLIC_APP_URL=https://your-domain` (used for Telegram links, X callback, wallet provider). Dev: `http://localhost:3000`.

## 12. $OMEN mint — when the token launches
`NEXT_PUBLIC_OMEN_MINT=<mint address>`. Until set, tiers can't read OMEN balances (whitelist/other tier sources still work).

## 13. Misc
- `NEXT_PUBLIC_ARC_RPC`: only if you use the Arc chain with your own RPC.
- `NEXT_PUBLIC_EARLY_ACCESS`: early-access gate flag. **Remove on Vercel at launch.**

---
## Not needed (safe to delete from .env.local)
`ANTHROPIC_API_KEY`, `TELEGRAM_CHAT_ID`, `FEE_WALLET`, `FEE_ACCOUNT` — nothing reads them from env.

## Checklist before going live
- [ ] Privy allowed origins include the production domain
- [ ] Atlas Network Access allows Vercel
- [ ] `NEXT_PUBLIC_APP_URL` = production domain
- [ ] `NEXT_PUBLIC_EARLY_ACCESS` removed
- [ ] Telegram webhook registered, `CRON_SECRET` set
- [ ] `NEXT_PUBLIC_OMEN_MINT` set after launch
