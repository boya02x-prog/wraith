import Link from "next/link";
import { ArrowRight } from "lucide-react";
import OpenSearch from "@/components/docs/OpenSearch";
import { DOCS, GROUPS } from "@/lib/docs";

// What each group is for, in one line (the group names themselves live in lib/docs).
const ABOUT: Record<string, string> = {
  "Start here": "What Wraith is, your first five minutes, and the Android app.",
  "Your money": "Cash, deposits, withdrawals, and what every fee is.",
  Discover: "Find tokens and the traders worth following.",
  Trade: "The token page, buying and selling, and selling automatically.",
  You: "Your profile, the Share studio, quests and alerts.",
  Safety: "Keeping your account and your money safe.",
  Help: "Quick answers, fixes and the glossary.",
};

export default function DocsHome() {
  const start = DOCS.find((d) => d.slug === "quickstart");
  return (
    <div className="dx-home">
      <header className="dx-hero">
        <span className="dx-eyebrow">Documentation</span>
        <h1>Everything about Wraith, in plain words.</h1>
        <p>How the app works, how to use it safely, and what every button does. Start at the top, or search for what you need.</p>
        <OpenSearch />
        {start && (
          <Link href={`/docs/${start.slug}`} className="dx-hero-go">
            Start with the quick start <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </header>

      {GROUPS.map((g) => (
        <section key={g} className="dx-group">
          <div className="dx-group-head">
            <h2>{g}</h2>
            {ABOUT[g] && <p>{ABOUT[g]}</p>}
          </div>
          <div className="dx-cards">
            {DOCS.filter((d) => d.group === g).map((d) => (
              <Link key={d.slug} href={`/docs/${d.slug}`} className="dx-card">
                <b>{d.title}</b>
                <span>{d.lead}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <p className="dx-foot">
        Wraith shows facts and readings, not advice. Tokens are high risk and you can lose everything you put in.{" "}
        Questions? Join the channel at{" "}
        <a href="https://t.me/wraithportal" target="_blank" rel="noreferrer noopener">t.me/wraithportal</a>.
      </p>
    </div>
  );
}
