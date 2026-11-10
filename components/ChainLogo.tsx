"use client";
// Chain logo. Drop a real logo at /public/chains/<key>.svg (solana, ethereum, base, bsc, monad, arc, robinhood)
// and it is used automatically; otherwise the built-in mark below shows.
import { useEffect, useRef, useState } from "react";

const BG: Record<string, string> = {
  solana: "#14141c", ethereum: "#627eea", base: "#0052ff", bsc: "#f3ba2f", monad: "#836ef9", arc: "#1fb5a8", robinhood: "#c3f53c",
};

function Mark({ k }: { k: string }) {
  switch (k) {
    case "solana":
      return (<g><defs><linearGradient id="slg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#9945ff"/><stop offset="1" stopColor="#14f195"/></linearGradient></defs>
        <path fill="url(#slg)" d="M6.2 15.3h10.4l1.2-1.3H7.4zM6.2 8.6h10.4l1.2 1.3H7.4zM7.4 12.7l-1.2-1.3h10.4l1.2 1.3z" transform="translate(0 -.4)"/></g>);
    case "ethereum":
      return <path fill="#fff" d="M12 4.5l-4.3 7.2L12 14.2l4.3-2.5zM12 15.2l-4.3-2.5L12 19.5l4.3-6.8z"/>;
    case "base":
      return <path fill="#fff" d="M12 18a6 6 0 1 0-5.9-7.1h8.1v2.2H6.1A6 6 0 0 0 12 18z"/>;
    case "bsc":
      return <path fill="#1a1a1a" d="M12 5l2 2-2 2-2-2zM7 10l2 2-2 2-2-2zM17 10l2 2-2 2-2-2zM12 15l2 2-2 2-2-2zM12 10.2l1.8 1.8L12 13.8 10.2 12z"/>;
    case "monad":
      return <path fill="#fff" d="M12 5.2l-6.8 6.8 6.8 6.8 6.8-6.8zM12 8.6c1.6 0 3.4 1.8 3.4 3.4S13.6 15.4 12 15.4 8.6 13.6 8.6 12 10.4 8.6 12 8.6z" fillRule="evenodd"/>;
    case "arc":
      return <path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" d="M7 17.5c0-6 2-10 5-10s5 4 5 10M9.4 14.2h5.2"/>;
    case "robinhood":
      return <path fill="#0b0b0b" d="M17.5 5.5c-5 .2-9.2 3-10.6 8.2l-1.4 4.8 1 .2c.9-1.5 2.1-2.6 3.5-3.5-.4 1-.6 2-.6 3.1l1 .2c.9-3 2.8-5.2 5.5-6.6-1.5.2-3 .8-4.2 1.8 2.7-1.8 5.3-4.7 5.8-8.2z"/>;
    default:
      return <circle cx="12" cy="12" r="4" fill="#fff"/>;
  }
}

export default function ChainLogo({ chain, size = 16, className = "" }: { chain?: string | null; size?: number; className?: string }) {
  const k = (chain || "").toLowerCase();
  // Official logos live in /public/chains/<key>.png; the built-in mark below is only the fallback if a file is missing.
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An <img> rendered on the server can fail before React attaches onError, so check once on mount.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken(true);
  }, []);
  if (!k) return null;
  const style = { width: size, height: size, flex: `0 0 ${size}px` } as const;
  if (!broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={ref} src={`/chains/${k}.png`} alt="" width={size} height={size} className={`wx-chain-logo ${className}`} style={{ ...style, borderRadius: "50%" }} onError={() => setBroken(true)} />
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={`wx-chain-logo ${className}`} style={{ ...style, borderRadius: "50%", background: BG[k] || "#333" }} aria-hidden="true">
      <Mark k={k} />
    </svg>
  );
}
