// All landing-page copy lives here. Edit text in this one file.
export const PORTAL = "https://t.me/wraithportal";
export const BOT = "https://t.me/wraithscan_bot";

export const HERO = {
  eyebrow: "Seven networks · one balance",
  title: ["See it first.", "Buy it from", "any chain."],
  accent: 2, // index of the line shown in the accent colour
  sub: "Wraith scans new tokens on Solana, Base, Ethereum, BNB Chain, Monad, Arc and Robinhood Chain, scores their upside and safety, and lets you buy with the stablecoins you already hold.",
  note: "Sign in with Google · wallets created for you · not financial advice",
};

export const STATS: { n: number; suffix?: string; prefix?: string; label: string }[] = [
  { n: 7, label: "Networks" },
  { n: 1, label: "Cash balance" },
  { n: 4, label: "Access tiers" },
  { n: 0, suffix: "%", label: "Fees at top tier" },
];

export const CHAINS = [
  ["solana", "Solana"], ["base", "Base"], ["ethereum", "Ethereum"], ["bsc", "BNB Chain"], ["monad", "Monad"], ["arc", "Arc"], ["robinhood", "Robinhood Chain"],
] as const;

export const SHOWCASE: { id: string; kicker: string; title: string; body: string; bullets: string[]; mock: "scanner" | "chart" | "paper" | "wins" }[] = [
  {
    id: "scanner", kicker: "Scanner and live signals", mock: "scanner",
    title: "New tokens, ranked before they trend.",
    body: "A live board of fresh tokens across every network, with age, market cap, liquidity and momentum on one row. Every call Wraith makes is tracked from the market cap where it was spotted.",
    bullets: ["Grid or table view, with quick buy on every row", "Hover a token for an instant chart card", "Signals are logged the moment they fire"],
  },
  {
    id: "charts", kicker: "Pro charts", mock: "chart",
    title: "Charts that open instantly.",
    body: "Candles or line, market cap or price, volume pane and a measure tool. History is saved, so tokens you have seen before open without waiting.",
    bullets: ["Live price merged into the current candle", "Jump back to the latest candle in one click", "Spotted-at marker shows where Wraith flagged it"],
  },
  {
    id: "paper", kicker: "Paper trading", mock: "paper",
    title: "Practice with fake cash. Same screens.",
    body: "Test a strategy with stop-loss, take-profit and trailing stop before real money is involved, and share the result as a PnL card.",
    bullets: ["SL / TP / trailing stop", "Shareable PnL cards", "Same screens as the real flow"],
  },
  {
    id: "wins", kicker: "Calls and Wins", mock: "wins",
    title: "Every call has a receipt.",
    body: "Each signal gets a score and is tracked from the market cap where it was spotted. The Wins history shows what actually worked, and how often.",
    bullets: ["HOT and WATCH calls, each with a 0-100 score", "Win milestones tracked server-side", "Win rate you can check, not a claim"],
  },
];

export const TELEGRAM_STEPS = [
  ["Open the bot", "Search @wraithscan_bot on Telegram and press Start."],
  ["Link your account", "In the app, open your profile and choose Connect Telegram. Approve the link in the chat."],
  ["Pick what you want", "Use /settings to choose signals, win milestones and the networks you care about."],
] as const;

export const SOON: { title: string; body: string }[] = [
  { title: "$OMEN token", body: "The tier token. Launch venue and date are not set yet." },
  { title: "Public launch", body: "Open sign-ups once the multi-chain flow is fully battle-tested." },
  { title: "Mobile app", body: "The web app already works on phones. A native app comes later." },
  { title: "More networks", body: "New chains are added as liquidity and routing support them." },
];

export const FAQ = [
  ["What is OMEN?", "OMEN is the Wraith token. Holding it sets your tier, which controls fees and which tools are unlocked. It has not launched yet."],
  ["Which networks can I trade on?", "Solana, Base, Ethereum, BNB Chain, Monad, Arc and Robinhood Chain. They share one cash balance."],
  ["Do you hold my funds?", "No. Wallets are embedded wallets that only you can approve from. You approve each transaction and can lock the wallet with a PIN."],
  ["What does it cost?", "A small per-trade fee that depends on your tier, from 1.5% with no OMEN down to 0% at the top tier. Network gas is separate."],
  ["Are the screens on this page real?", "Yes. The numbers, tokens and Telegram messages on this page come from the same server-side call record the app uses, refreshed every 30 seconds."],
  ["Is this financial advice?", "No. Early-stage tokens are extremely volatile and most lose value. Only trade what you can afford to lose."],
] as const;
