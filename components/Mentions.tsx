"use client";
// "Mentioned by": where this token is talked about that Wraith can actually see, with no paid feed: the creator's linked X post /
// website / Telegram (from Jupiter's token info), and posts about it by Wraith traders. It says plainly what it cannot see.
import { useEffect, useState } from "react";
import { Globe, Send } from "lucide-react";
import { SiteIcon, TelegramIcon, XIcon } from "@/components/BrandIcons";

interface Links { twitter: string | null; website: string | null; telegram: string | null }
interface Post { id?: string; displayName?: string; username?: string | null; createdAt?: number | string }

export default function Mentions({ mint, name, symbol }: { mint: string; name: string; symbol: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [links, setLinks] = useState<Links | null>(null);
  useEffect(() => {
    let on = true;
    if (name || symbol) fetch(`/api/token-lookalikes?mint=${encodeURIComponent(mint)}&name=${encodeURIComponent(name)}&symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((d: { self?: Links | null }) => { if (on) setLinks(d.self ?? null); }).catch(() => undefined);
    fetch(`/api/callouts?mint=${encodeURIComponent(mint)}&limit=30`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d: { callouts?: Post[] } | null) => { if (on) setPosts(d?.callouts ?? []); }).catch(() => { if (on) setPosts([]); });
    return () => { on = false; };
  }, [mint, name, symbol]);
  const people = new Set((posts ?? []).map((p) => p.username ?? p.displayName ?? "")).size;
  const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/^(x|twitter)\.com\//i, "@").replace(/\/status\/(\d+).*$/i, " · post").replace(/\/$/, "");
  const isPost = (u?: string | null) => !!u && /(x|twitter)\.com\/[^/]+\/status\//i.test(u);
  const row = (icon: React.ReactNode, label: string, url: string | null | undefined) => url
    ? <a className="mn-row" href={url} target="_blank" rel="noopener noreferrer"><i>{icon}</i><b>{label}</b><span>{short(url)}</span></a>
    : <div className="mn-row off"><i>{icon}</i><b>{label}</b><span>not linked</span></div>;
  return (
    <section className="mn">
      <div className="mn-head"><b>Mentioned by</b><span>what Wraith can see</span></div>
      <div className="mn-rows">
        {row(<XIcon size={16} />, isPost(links?.twitter) ? "Linked X post" : "Creator's X", links?.twitter)}
        {row(links?.website ? <SiteIcon url={links.website} size={18} /> : <Globe size={18} />, isPost(links?.website) ? "Linked post" : "Website", links?.website)}
        {row(links?.telegram ? <TelegramIcon size={18} /> : <Send size={17} />, "Telegram", links?.telegram)}
        <div className={`mn-row${posts && posts.length ? "" : " off"}`}><i><img src="/logo.svg" width={18} height={18} alt="" /></i><b>Wraith traders</b><span>{posts === null ? "checking…" : posts.length ? `${posts.length} post${posts.length > 1 ? "s" : ""} from ${people} trader${people > 1 ? "s" : ""}` : "no posts yet"}</span></div>
      </div>
      <p className="mn-note">Posts on X, Telegram groups and news that mention this token&apos;s address are not visible to Wraith: they need paid or login-only access.</p>
    </section>
  );
}
