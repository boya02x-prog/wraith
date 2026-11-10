// A Web Push "endpoint" is a URL our SERVER later POSTs to. The browser hands it to us, so without a check anyone could register
// https://some-internal-or-attacker-host/... and have the server call it (server-side request forgery), or use the cron fan-out to
// hammer a third party. Real endpoints only ever live on the browser vendors' push services, so that is all we accept.
const PUSH_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome, Brave, Opera, Samsung Internet, Vivaldi
  /^android\.googleapis\.com$/, // legacy Chrome endpoints
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)push\.apple\.com$/, // Safari / iOS home-screen apps
  /(^|\.)notify\.windows\.com$/, // Edge
];

export function isPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 1200) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((re) => re.test(host));
}

/** Most devices one account may register (phones, browsers, the app). */
export const MAX_PUSH_DEVICES = 12;
