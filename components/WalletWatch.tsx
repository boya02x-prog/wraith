"use client";

// A warning right where you buy: are wallets Wraith has seen dump before already in this token, or proven ones?
// Reads the same wallet intel as the Analysis tab (cached on the server), and stays silent when there is nothing to say.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import WalletAvatar from "@/components/WalletAvatar";
import { walletName } from "@/lib/walletIdentity";

interface Familiar { wallet: string; n: number; wins: number; dumps: number }
interface Intel { buyers?: number; proven?: number; dumpers?: number; familiar?: Familiar[] }

export default function WalletWatch({ mint }: { mint: string }) {
  const [intel, setIntel] = useState<Intel | null>(null);
  useEffect(() => {
    let alive = true;
    setIntel(null);
    fetch(`/api/wallet-intel?mint=${encodeURIComponent(mint)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Intel | null) => { if (alive && d) setIntel(d); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [mint]);

  if (!intel) return null;
  const dumpers = intel.dumpers ?? 0, proven = intel.proven ?? 0;
  if (!dumpers && !proven) return null;
  const bad = dumpers >= 3;
  const warn = dumpers > 0;
  const faces = (intel.familiar ?? []).filter((f) => (dumpers ? f.n >= 4 && f.dumps / f.n >= 0.75 : f.wins >= 1)).slice(0, 4);
  const tone = bad ? "#ef4444" : warn ? "#f59e0b" : "#22c55e";
  return (
    <div className="ww" style={{ borderColor: tone, background: `${tone}14` }} role="status">
      <span className="ww-ico" style={{ color: tone }}>{warn ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}</span>
      <div className="ww-txt">
        <b style={{ color: tone }}>
          {warn
            ? `${dumpers} repeat-dumper wallet${dumpers > 1 ? "s" : ""} bought early`
            : `${proven} proven wallet${proven > 1 ? "s" : ""} bought early`}
        </b>
        <span>
          {warn
            ? "Wallets Wraith has seen end in a big loss again and again are in this token. Be careful with size."
            : "Wallets that were early in past winners are in this token. It is a hint, not a promise."}
          {warn && proven ? ` ${proven} proven wallet${proven > 1 ? "s are" : " is"} in too.` : ""}
        </span>
      </div>
      {faces.length > 0 && (
        <span className="ww-faces">
          {faces.map((f) => <Link key={f.wallet} href={`/app/w/${f.wallet}`} title={`${walletName(f.wallet)} · ${f.dumps} dumps / ${f.wins} wins in ${f.n} calls`}><WalletAvatar address={f.wallet} size={26} /></Link>)}
        </span>
      )}
    </div>
  );
}
