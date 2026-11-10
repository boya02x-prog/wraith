"use client";

import { KIND_INFO, walletHue, type WalletKind } from "@/lib/walletIdentity";

/** A little ghost, coloured from the wallet address, with its type as a badge. Same wallet = same ghost everywhere. */
export default function WalletAvatar({ address, kind = "regular", size = 40 }: { address: string; kind?: WalletKind; size?: number }) {
  const h = walletHue(address);
  const info = KIND_INFO[kind];
  const id = `g${address.slice(0, 6)}${size}`;
  return (
    <span className="wa" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`hsl(${h} 85% 68%)`} />
            <stop offset="1" stopColor={`hsl(${(h + 40) % 360} 75% 42%)`} />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="31" fill={`hsl(${h} 40% 14%)`} />
        <path d="M32 11c-9.5 0-16 7-16 16.5V50l5.2-4 5.4 4.8 5.4-4.8L37 50.8l5.4-4.8 5.6 4V27.5C48 18 41.5 11 32 11Z" fill={`url(#${id})`} />
        <ellipse cx="26" cy="29" rx="3.2" ry="3.8" fill="#0c0c0d" opacity=".85" />
        <ellipse cx="38" cy="29" rx="3.2" ry="3.8" fill="#0c0c0d" opacity=".85" />
      </svg>
      <i className="wa-kind" style={{ background: info.color }} title={info.label}>{info.emoji}</i>
    </span>
  );
}
