/**
 * Quick check of the wallet profile data for a couple of wallets: history, net worth, and whether tokens get a name and logo.
 *   npx tsx scripts/research-wallet-profile.ts [wallet ...]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

(async () => {
  const { walletHistory } = await import("../lib/walletHistory");
  const { walletNetWorth, assetMeta } = await import("../lib/walletAssets");
  const wallets = process.argv.slice(2).length ? process.argv.slice(2) : ["7PuezJpw3z8WA7WfCp6gTH3oTW37NwDCfwRcTWKPQL78", "Eu6Vj9Ed5548aZPYG8UNMn7zzkKwcynry1wghhQXjRVY"];
  for (const w of wallets) {
    const t0 = Date.now();
    const [h, nw] = await Promise.all([walletHistory(w), walletNetWorth(w)]);
    const t1 = Date.now();
    const mints = (h?.tokens ?? []).slice(0, 30).map((t) => t.mint);
    const meta = await assetMeta(mints);
    console.log(w.slice(0, 5), `history+networth ${t1 - t0}ms, meta ${Date.now() - t1}ms`);
    console.log("  net worth:", nw ? `$${nw.totalUsd.toFixed(0)} (SOL ${nw.solBalance.toFixed(2)}, tokens $${nw.tokensUsd.toFixed(0)}, ${nw.holdings.length} holdings)` : "none");
    const withSym = mints.filter((m) => meta.get(m)?.symbol).length, withImg = mints.filter((m) => meta.get(m)?.image).length;
    console.log(`  tokens ${mints.length}: with symbol ${withSym}, with image ${withImg}`);
    console.log("  sample:", mints.slice(0, 5).map((m) => `${meta.get(m)?.symbol || "?"}${meta.get(m)?.image ? " (img)" : ""}`).join(", "));
  }
})();
