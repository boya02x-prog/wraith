// Launch control: the switches Jii flips from /app/admin, stored in Mongo (app_settings/_id "launch").
// Shared by the server and the browser, so nothing secret lives here. No redeploy is needed to change any of it.

export type RoadmapStatus = "soon" | "live";
export interface RoadmapItem { id: string; title: string; body: string; status: RoadmapStatus; date: string }

export interface LaunchSettings {
  /** Pre-launch beta: every signed-in user gets every tool (signals, auto-sell, Telegram alerts, AI score, hot wallet). Fees stay normal. */
  featuresFree: boolean;
  /** OMEN holdings decide tiers, fee discounts and the gas boost. Needs omenMint. */
  tiersLive: boolean;
  /** OMEN SPL mint address (Solana). Empty until the token exists. */
  omenMint: string;
  /** When OMEN launches (ISO string, "" = not set). Shown on the landing page and the admin countdown. */
  omenLaunchAt: string;
  /** At omenLaunchAt, switch to launch mode by itself (tiers live, beta off). Needs omenMint. */
  autoLaunch: boolean;
  /** Holders-only Telegram room accepts members. */
  vipRoomOpen: boolean;
  /** Quests earn points (tasks, trades, invites, posts, bug reports). */
  questsOpen: boolean;
  /** Points are final and the airdrop claim button is live. */
  claimOpen: boolean;
  /** When the airdrop claim opens (ISO string, "" = not set). */
  claimAt: string;
  /** Optional one-line announcement shown on the landing page. */
  banner: string;
  roadmap: RoadmapItem[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_ROADMAP: RoadmapItem[] = [
  { id: "omen", title: "$OMEN token", body: "The tier token. Holding it lowers your fee and keeps the pro tools after launch.", status: "soon", date: "" },
  { id: "airdrop", title: "Quests airdrop", body: "Points from quests, trades and invites turn into OMEN at launch.", status: "soon", date: "" },
  { id: "public", title: "Public launch", body: "Open sign-ups once the multi-chain flow is fully battle-tested.", status: "soon", date: "" },
  { id: "mobile", title: "Mobile app", body: "Android first, then iOS. The web app already works on phones.", status: "soon", date: "" },
  { id: "networks", title: "More networks", body: "New chains are added as liquidity and routing support them.", status: "soon", date: "" },
];

export const DEFAULT_SETTINGS: LaunchSettings = {
  featuresFree: true,
  tiersLive: false,
  omenMint: "",
  omenLaunchAt: "",
  autoLaunch: false,
  vipRoomOpen: false,
  questsOpen: true,
  claimOpen: false,
  claimAt: "",
  banner: "",
  roadmap: DEFAULT_ROADMAP,
};

export const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Applies the auto-launch schedule. Use this everywhere instead of reading the raw doc. */
export function resolveSettings(s: LaunchSettings, now = Date.now()): LaunchSettings {
  const at = s.omenLaunchAt ? Date.parse(s.omenLaunchAt) : NaN;
  if (s.autoLaunch && MINT_RE.test(s.omenMint) && Number.isFinite(at) && now >= at) {
    return {
      ...s,
      tiersLive: true,
      featuresFree: false,
      vipRoomOpen: true,
      roadmap: s.roadmap.map((r) => (r.id === "omen" ? { ...r, status: "live" } : r)),
    };
  }
  return s;
}

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001F]/g, " ").trim().slice(0, max) : "");
const iso = (v: unknown) => {
  const t = typeof v === "string" && v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};

/** Cleans anything (a DB doc or an admin PUT body) into valid settings, falling back to the defaults. */
export function normalizeSettings(raw: unknown, base: LaunchSettings = DEFAULT_SETTINGS): LaunchSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mint = str(r.omenMint ?? base.omenMint, 64);
  const road = Array.isArray(r.roadmap) ? r.roadmap : base.roadmap;
  return {
    featuresFree: bool(r.featuresFree, base.featuresFree),
    tiersLive: bool(r.tiersLive, base.tiersLive),
    omenMint: MINT_RE.test(mint) ? mint : "",
    omenLaunchAt: "omenLaunchAt" in r ? iso(r.omenLaunchAt) : base.omenLaunchAt,
    autoLaunch: bool(r.autoLaunch, base.autoLaunch),
    vipRoomOpen: bool(r.vipRoomOpen, base.vipRoomOpen),
    questsOpen: bool(r.questsOpen, base.questsOpen),
    claimOpen: bool(r.claimOpen, base.claimOpen),
    claimAt: "claimAt" in r ? iso(r.claimAt) : base.claimAt,
    banner: "banner" in r ? str(r.banner, 160) : base.banner,
    roadmap: road.slice(0, 12).map((x, i) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        id: str(o.id, 24) || `item${i}`,
        title: str(o.title, 60) || "Untitled",
        body: str(o.body, 220),
        status: o.status === "live" ? "live" : "soon",
        date: iso(o.date),
      } satisfies RoadmapItem;
    }),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : r.updatedAt instanceof Date ? r.updatedAt.toISOString() : base.updatedAt,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : base.updatedBy,
  };
}

/** Everything OMEN touches, for the admin checklist and the landing page. */
export const LAUNCH_ITEMS: { id: string; label: string; before: string; after: string }[] = [
  { id: "scanner", label: "Scanner, charts, trading, paper trading", before: "Free for everyone", after: "Free for everyone" },
  { id: "signals", label: "Live signals feed", before: "Unlocked by the beta switch", after: "WRAITH holders (1M OMEN)" },
  { id: "autosell", label: "Auto TP/SL/trail, hot wallet", before: "Unlocked by the beta switch", after: "SHADE+ (250K OMEN)" },
  { id: "alerts", label: "Telegram DM alerts + AI score", before: "Unlocked by the beta switch", after: "SPECTER+ (500K OMEN)" },
  { id: "fees", label: "Fee discounts (1.5% → 0%)", before: "Everyone pays 1.5%", after: "By OMEN tier when tiers are live" },
  { id: "gas", label: "Gas sponsorship boost", before: "Off", after: "OMEN holders get a bigger boost" },
  { id: "vip", label: "Holders-only Telegram room", before: "Closed", after: "SPECTER+ when the room is open" },
  { id: "quests", label: "Quests points", before: "Earning", after: "Freeze when you open the claim" },
  { id: "claim", label: "Airdrop claim", before: "Closed", after: "Open when you flip it" },
];
