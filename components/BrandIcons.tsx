// Small brand marks for the "Mentioned by" and lookalike cards: X, Telegram, and a site's own favicon.
export function XIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.261 5.636 5.903-5.636Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" /></svg>;
}
export function TelegramIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#2AABEE" /><path d="M5.4 11.8c3.5-1.5 5.8-2.5 7-3 3.3-1.4 4-1.6 4.4-1.6.1 0 .3 0 .4.1.1.1.2.2.2.3v.5c-.4 3.2-1.4 7.3-1.7 8.6-.1.5-.4.7-.8.7-.5 0-1.5-.7-2.3-1.3-1.3-.9-2-1.4-3.2-2.2-1.4-1-.5-1.5.3-2.3.2-.2 3.8-3.5 3.9-3.8 0-.1 0-.2-.1-.2s-.2 0-.3.1c-.1.1-2.1 1.3-5.8 3.8-.5.4-1 .5-1.4.5-.5 0-1.3-.3-2-.5-.8-.3-1.4-.4-1.4-.9 0-.2.3-.5.9-.7Z" fill="#fff" /></svg>;
}
/** the site's own icon (favicon); falls back to a plain globe if it cannot load */
export function SiteIcon({ url, size = 16 }: { url: string; size?: number }) {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a URL */ }
  if (!host) return <span style={{ width: size, height: size, display: "inline-block" }} />;
  if (/(^|\.)(x|twitter)\.com$/i.test(host)) return <XIcon size={size} />;
  if (/(^|\.)(t\.me|telegram\.me)$/i.test(host)) return <TelegramIcon size={size} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`} width={size} height={size} alt="" style={{ borderRadius: 4 }} loading="lazy" />;
}
