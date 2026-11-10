// lib/visibleInterval.ts  (client only)
// setInterval that does nothing while the tab / app is hidden, then catches up once the moment it is visible again.
// Use it for DISPLAY polling: a backgrounded phone must not keep hitting the API (battery, mobile data, server load
// multiplied by every open tab). Do NOT use it for trading automation (auto-exit, sniper, TP/SL monitors): those have to
// keep running. Returns the normal interval id, so clearInterval / window.clearInterval work as usual.
const missed = new Map<number, () => void>();
let bound = false;

function bind() {
  if (bound || typeof document === "undefined") return;
  bound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const todo = [...missed.values()];
    missed.clear();
    for (const fn of todo) {
      try { fn(); } catch { /* one poller never blocks the others */ }
    }
  });
}

export function visibleInterval(fn: () => void, ms: number): number {
  bind();
  const id: number = window.setInterval(() => {
    if (document.hidden) { missed.set(id, fn); return; }
    missed.delete(id);
    fn();
  }, ms);
  return id;
}
