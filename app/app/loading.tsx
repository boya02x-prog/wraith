// Shown the instant you tap to another screen, while its data loads, so a tap never feels dead.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ padding: "16px 14px", display: "grid", gap: 12 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="wsk-b" style={{ height: i === 0 ? 120 : 76, borderRadius: 14 }} />
      ))}
    </div>
  );
}
