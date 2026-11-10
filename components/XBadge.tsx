// Small X mark shown beside a name when that trader has linked a verified X account.
export default function XBadge({ handle, size = 12 }: { handle?: string | null; size?: number }) {
  if (!handle) return null;
  return (
    <a
      href={`https://x.com/${encodeURIComponent(handle)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="x-badge"
      title={`@${handle} on X`}
      aria-label={`@${handle} on X`}
      onClick={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", alignItems: "center", marginLeft: 5, color: "var(--text-muted)", verticalAlign: "middle" }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
    </a>
  );
}
