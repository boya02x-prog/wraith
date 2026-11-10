const RESERVED = new Set([
  "admin", "wraith", "support", "root", "moderator", "mod", "help", "info",
  "news", "official", "team", "staff", "api", "bot", "system", "null",
  "undefined", "user", "users", "profile", "login", "logout", "register",
  "signup", "app", "me", "everyone", "anonymous", "moderators", "wraith_hq",
  "wraith_official", "contact", "security", "billing", "privacy", "terms",
  "about", "home", "index", "feed",
]);

export type UsernameCheck =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

export function validateUsername(raw: string): UsernameCheck {
  const normalized = raw.toLowerCase().trim();
  if (normalized.length < 3)
    return { ok: false, error: "Username must be at least 3 characters." };
  if (normalized.length > 20)
    return { ok: false, error: "Username must be 20 characters or fewer." };
  if (!/^[a-z0-9][a-z0-9_]*$/.test(normalized))
    return {
      ok: false,
      error:
        "Use letters, numbers, and underscores only. Must start with a letter or number.",
    };
  if (/__/.test(normalized))
    return {
      ok: false,
      error: "Username cannot contain consecutive underscores.",
    };
  if (RESERVED.has(normalized))
    return { ok: false, error: "That username is reserved." };
  return { ok: true, normalized };
}

/** Suggest a username from a display name — strips symbols, truncates. */
export function suggestUsername(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  if (base.length >= 3) return base;
  return `trader${Math.floor(Math.random() * 9000) + 1000}`;
}
