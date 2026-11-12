import type { Metadata, Viewport } from "next";
import PullToRefresh from "@/components/PullToRefresh";
import MobileWebGate from "@/components/MobileWebGate";
import localFont from "next/font/local";
import "./globals.css";
import "./wraith-ui.css";
import "./wraith-polish.css";
import "./wraith-responsive.css";
import "./wraith-mobile.css";
import "./wraith-compact.css";
import WalletProvider from "@/components/WalletProvider";
import BootSplash from "@/components/BootSplash";
import NativePush from "@/components/NativePush";
import ScrollRestore from "@/components/ScrollRestore";
import RouteFade from "@/components/RouteFade";
import NativeLinks from "@/components/NativeLinks";
import OpenInApp from "@/components/OpenInApp";
import FcmLink from "@/components/FcmLink";
import SwRegister from "@/components/SwRegister";
import RefCapture from "@/components/RefCapture";
import { WraithTierProvider } from "@/hooks/useWraithTier";

// Self-hosted (latin subset). next/font/google downloads from Google at build/dev time, which broke Turbopack once Google
// switched some families to "fonts.gstatic.com/l/font?kit=..." URLs, and makes every build depend on Google being up.
const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-mono",
});

const display = localFont({
  src: [{ path: "./fonts/anton-latin-400-normal.woff2", weight: "400", style: "normal" }],
  display: "swap",
  variable: "--font-display",
});

const SITE = "https://www.wraith.farm";
const TITLE = "Wraith: trade every chain from one cash balance";
const DESC = "Multi-chain token scanner and trading platform. Find tokens with real upside across Solana, Base, Ethereum, BNB Chain, Monad, Arc and Robinhood Chain, with safety scores, Telegram alerts and paper trading.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s | Wraith" },
  description: DESC,
  applicationName: "Wraith",
  keywords: ["token scanner", "crypto token scanner", "multi-chain token scanner", "new token alerts", "crypto signals", "paper trading", "Telegram crypto alerts", "multi-chain trading", "Wraith"],
  authors: [{ name: "Wraith", url: SITE }],
  creator: "Wraith",
  publisher: "Wraith",
  category: "finance",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Wraith",
    url: SITE,
    title: TITLE,
    description: DESC,
    locale: "en_US",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Wraith, the multi-chain token scanner" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/og.png"] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  appleWebApp: { capable: true, title: "Wraith", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icon.png", type: "image/png" }], apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0c0c0d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html,body{background:#0c0c0d}#wx-boot{position:fixed;inset:0;z-index:2147483000;display:none;place-items:center;background:#0c0c0d}#wx-boot img{width:min(18vw,110px);height:auto}@media (display-mode:standalone),(display-mode:fullscreen),(display-mode:minimal-ui){#wx-boot{display:grid}}html.wx-native #wx-boot{display:grid}#wx-boot[hidden],html.wx-booted #wx-boot{display:none!important}@media (hover:hover) and (pointer:fine){#wx-boot{display:none!important}}` }} />
        {/* The ghost splash is for a cold start only: the first page load of this app session. Later full page loads (pull to refresh, a link
            that reloads, coming back after sign-in) skip it, and a desktop mouse-and-keyboard browser never shows it. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var s=sessionStorage;if(s.getItem("wx_booted"))document.documentElement.classList.add("wx-booted");else s.setItem("wx_booted","1")}catch(e){}` }} />
        <script dangerouslySetInnerHTML={{ __html: `if(/WraithApp/.test(navigator.userAgent)){var d=document.documentElement;d.classList.add("wx-native");try{var i=JSON.parse(window.WraithInsets.get());d.style.setProperty("--wx-top",i.t+"px");d.style.setProperty("--wx-bottom",i.b+"px");d.style.setProperty("--wx-left",i.l+"px");d.style.setProperty("--wx-right",i.r+"px")}catch(e){}}` }} />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var L=localStorage,d=document.documentElement;if(location.pathname.indexOf("/app")!==0)return;var b=null;try{b=JSON.parse(L.getItem("wraith_applock_v1")||"null")}catch(e){}var nb=!!(b&&b.on&&b.id==="native"),bo=!!(b&&b.on&&b.id!=="native"&&window.PublicKeyCredential),pn=L.getItem("wraith_pin_enabled")==="true"&&!!L.getItem("wraith_pin_hash");if(!bo&&!pn&&!nb)return;var t=parseInt(L.getItem("wraith_pin_timeout_ms")||"300000",10);if(t===0)return;var la=parseInt(L.getItem("wraith_last_active")||"0",10);if(Date.now()-la<=t)return;d.classList.add("wx-prelock");if(bo){var s=b.id.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((b.id.length+3)%4),r=atob(s),u=new Uint8Array(r.length);for(var i=0;i<r.length;i++)u[i]=r.charCodeAt(i);window.__wxBio=navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rpId:location.hostname,allowCredentials:[{id:u,type:"public-key",transports:["internal"]}],userVerification:"required",timeout:60000}});window.__wxBio.catch(function(){})}}catch(e){}})();` }} />
      </head>
      <body>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div id="wx-boot" aria-hidden="true"><img src="/ghost.png" alt="" /></div>
        <BootSplash />
        <FcmLink />
        <NativePush />
        <ScrollRestore />
        <RouteFade />
        <NativeLinks />
        <OpenInApp />
        <SwRegister />
        <RefCapture />
        <PullToRefresh />
        <MobileWebGate />
        <WalletProvider>
          <WraithTierProvider>{children}</WraithTierProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
