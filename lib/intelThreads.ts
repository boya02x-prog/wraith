// Someone who posts intel on the same token more than once gets a thread, like on X: those posts sit together (oldest first, at the place of the newest) and a line
// runs down the left from one avatar to the next. `up` = there is a post of the thread above this one, `down` = one below.
export type Threaded<T> = { item: T; up: boolean; down: boolean };

export function threadOrder<T extends { userId: string; mint?: string | null; createdAt: number }>(items: T[]): Threaded<T>[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (!it.mint) continue;
    const k = `${it.userId}|${it.mint}`;
    const g = groups.get(k);
    if (g) g.push(it); else groups.set(k, [it]);
  }
  const out: Threaded<T>[] = [];
  const done = new Set<string>();
  for (const it of items) {
    const k = it.mint ? `${it.userId}|${it.mint}` : "";
    const g = k ? groups.get(k) : undefined;
    if (!g || g.length < 2) { out.push({ item: it, up: false, down: false }); continue; }
    if (done.has(k)) continue;
    done.add(k);
    const sorted = [...g].sort((a, b) => a.createdAt - b.createdAt);
    sorted.forEach((x, i) => out.push({ item: x, up: i > 0, down: i < sorted.length - 1 }));
  }
  return out;
}
