"use client";
// Admin: "Ready to launch?" checklist. Each line is checked live (gas wallets, token address, site access) and links to the card where it is fixed.
import { useEffect, useState } from "react";
import { Check, CircleAlert, ListChecks } from "lucide-react";
import type { LaunchSettings } from "@/lib/launchSettings";
import { MINT_RE } from "@/lib/launchSettings";

type Gas = { solana: { topups: number; sol: number } | null; evm: { chains: { chain: string; topups: number }[] } | null };
type Item = { ok: boolean | null; title: string; detail: string; href: string; optional?: boolean };

export default function AdminChecklist({ settings }: { settings: LaunchSettings }) {
  const [gas, setGas] = useState<Gas | null>(null);
  useEffect(() => {
    let on = true;
    fetch("/api/admin/gas-wallets", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on) setGas(j); }).catch(() => undefined);
    return () => { on = false; };
  }, []);
  const solOk = gas?.solana ? gas.solana.topups >= 100 : null;
  const evmFunded = gas?.evm ? gas.evm.chains.filter((c) => c.topups >= 100).length : null;
  const items: Item[] = [
    { ok: solOk, title: "Solana gas wallet is funded", detail: gas?.solana ? `${gas.solana.sol.toFixed(3)} SOL, about ${gas.solana.topups.toLocaleString()} first-trade top-ups. Aim for 100 or more.` : "Checking…", href: "#gas" },
    { ok: evmFunded === null ? null : evmFunded >= 1, title: "EVM gas wallet is funded (at least Base)", detail: gas?.evm ? `${evmFunded} of ${gas.evm.chains.length} chains have enough for 100 top-ups.` : "Checking…", href: "#gas" },
    { ok: MINT_RE.test(settings.omenMint), title: "OMEN token address is saved", detail: MINT_RE.test(settings.omenMint) ? "Saved. The bottom bar shows the OMEN market cap." : "Launch the token, then paste its address in the Launch card.", href: "#launch", optional: true },
    { ok: !settings.showAirdrop, title: "Airdrop is hidden from users", detail: settings.showAirdrop ? "Quests and airdrop are visible to everyone. Turn that off below if it is not ready." : "Hidden: users do not see quests, points or any airdrop wording.", href: "#airdrop" },
    { ok: !settings.siteOpen ? false : true, title: "Site access", detail: settings.siteOpen ? "The site is OPEN to everyone." : "The site is still PRIVATE. Press \"Open the site to everyone\" when everything above is green.", href: "#access" },
  ];
  const blockers = items.filter((i) => i.ok === false && !i.optional && i.href !== "#access").length;
  return (
    <section className="q-card ad-card" id="checklist">
      <h2><ListChecks size={16} /> Ready to launch?</h2>
      <p className="q-note">{blockers === 0 ? "Everything required is green. You can open the site." : `${blockers} thing${blockers > 1 ? "s" : ""} to fix before you open the site.`}</p>
      <div className="ck-list">
        {items.map((i) => (
          <a key={i.title} href={i.href} className={`ck-item${i.ok ? " ok" : i.ok === false ? " bad" : ""}`}>
            <i>{i.ok ? <Check size={14} /> : <CircleAlert size={14} />}</i>
            <span><b>{i.title}{i.optional ? " (when the token exists)" : ""}</b><small>{i.detail}</small></span>
          </a>
        ))}
      </div>
    </section>
  );
}
