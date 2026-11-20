"use client";

// Two extra leaderboards under the Hot shots banner: the most followed traders and the top earners (all-time realized profit). They come from
// /api/traders/boards and appear only when there is someone to show.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Trophy, Users } from "lucide-react";
import Frame, { frameGlow } from "@/components/Frame";
import { useCash } from "@/lib/cash";
import { defaultAvatar } from "@/lib/defaultArt";
import { readLast, writeLast } from "@/lib/lastGood";

type Row = { userId: string; username: string | null; displayName: string; avatarDataUrl: string; frame: string; followers?: number; profitSol?: number; trades?: number; isSelf?: boolean };
type Boards = { followed: Row[]; earners: Row[] };

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

function Board({ title, icon, rows, value, note }: { title: string; icon: React.ReactNode; rows: Row[]; value: (r: Row) => string; note: string }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <section className="bd" aria-label={title}>
      <header className="bd-head">
        {icon}
        <h3>{title}</h3>
        <small>{note}</small>
      </header>
      <ol className="bd-list">
        {shown.map((r, i) => (
          <li key={r.userId} className="bd-row" style={frameGlow(r.frame)}>
            <span className={`bd-n n${i + 1}`}>{i + 1}</span>
            <Frame id={r.frame} thick={2.5} className="bd-av">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-zoom src={r.avatarDataUrl || defaultAvatar(r.userId)} alt="" draggable={false} />
            </Frame>
            <Link className="bd-id" href={`/app/u/${encodeURIComponent(r.username ?? r.userId)}`}>
              <b>{r.displayName}</b>
              <small>{r.username ? `@${r.username}` : "Trader"}</small>
            </Link>
            <strong className="bd-val">{value(r)}</strong>
          </li>
        ))}
      </ol>
      {rows.length > FIRST && (
        <button type="button" className="bd-more" onClick={() => setAll((v) => !v)}>{all ? "Show less" : `Show all ${rows.length}`}</button>
      )}
    </section>
  );
}

/** how many rows of each board show before "Show all" */
const FIRST = 5;

/** `onShown` tells the page who is on show in the boards, so the ranking cards below do not list the same person a second time. */
export default function TraderBoards({ onShown }: { onShown?: (ids: string[]) => void }) {
  const { money } = useCash();
  // a saved copy from an older shape (or a bad answer) must not crash the page: only a well-formed pair of lists counts
  const wellFormed = (d: Boards | null): d is Boards => !!d && Array.isArray(d.followed) && Array.isArray(d.earners);
  const [data, setData] = useState<Boards | null>(() => { const d = readLast<Boards>("traders-boards"); return wellFormed(d) ? d : null; });

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/traders/boards")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Boards | null) => { if (alive && wellFormed(d)) { setData(d); writeLast("traders-boards", d); } })
        .catch(() => undefined);
    void load();
    window.addEventListener("wraith:refresh", load);
    return () => { alive = false; window.removeEventListener("wraith:refresh", load); };
  }, []);

  const shownKey = data ? [...data.followed.slice(0, FIRST), ...data.earners.slice(0, FIRST)].map((r) => r.userId).join(",") : "";
  useEffect(() => { onShown?.(shownKey ? shownKey.split(",") : []); }, [shownKey, onShown]);

  if (!data || (!data.followed.length && !data.earners.length)) return null;
  return (
    <div className="bd-wrap">
      <Board title="Most followed" icon={<Users size={17} aria-hidden="true" />} rows={data.followed} value={(r) => `${compact(r.followers ?? 0)} ${r.followers === 1 ? "follower" : "followers"}`} note="who people follow" />
      <Board title="Top earners" icon={<Trophy size={17} aria-hidden="true" />} rows={data.earners} value={(r) => money(r.profitSol ?? 0, true)} note="all-time profit" />
    </div>
  );
}
