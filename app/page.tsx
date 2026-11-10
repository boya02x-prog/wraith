import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "Wraith: trade every chain from one cash balance",
  description: "Scan new tokens on Solana, Base, Ethereum, BNB Chain, Monad, Arc and Robinhood Chain, find the ones with real upside, and buy with the stablecoins you already hold.",
  openGraph: {
    title: "Wraith: trade every chain from one cash balance",
    description: "Multi-chain token scanner and trading platform with Telegram alerts and OMEN holder tiers.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Wraith, the multi-chain token scanner" }],
    url: "https://www.wraith.farm",
    siteName: "Wraith",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Wraith: trade every chain from one cash balance", description: "Multi-chain token scanner and trading platform with Telegram alerts.", images: ["/og.png"] },
  alternates: { canonical: "/" },
};

const LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": "https://www.wraith.farm/#org", name: "Wraith", url: "https://www.wraith.farm", logo: "https://www.wraith.farm/icon-512.png" },
    { "@type": "WebSite", "@id": "https://www.wraith.farm/#site", url: "https://www.wraith.farm", name: "Wraith", publisher: { "@id": "https://www.wraith.farm/#org" } },
    { "@type": "SoftwareApplication", name: "Wraith", applicationCategory: "FinanceApplication", operatingSystem: "Web, Android", url: "https://www.wraith.farm", image: "https://www.wraith.farm/og.png", description: "Multi-chain token scanner and trading platform with Telegram alerts.", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
  ],
};

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LD) }} />
      <Landing />
    </>
  );
}
