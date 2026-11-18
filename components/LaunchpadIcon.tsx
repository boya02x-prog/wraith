"use client";
// The launchpad a token came from, shown as a small logo only (the name is the tooltip), next to the network logo.
// pump.fun is drawn as its capsule; the others get a plain rounded badge with their initial until their real marks are added.
import { launchpadOf } from "@/lib/launchpad";

export default function LaunchpadIcon({ address, chain, size = 18 }: { address: string | null | undefined; chain?: string | null; size?: number }) {
  const name = launchpadOf(address, chain);
  if (!name) return null;
  return (
    <span className="wx-lp-logo" title={`Launched on ${name}`} aria-label={`Launched on ${name}`} style={{ width: size, height: size }}>
      {name === "pump.fun" ? (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <g transform="rotate(-45 12 12)">
            <rect x="3.5" y="7.5" width="17" height="9" rx="4.5" fill="#f4f4f5" />
            <path d="M8 7.5h4v9H8a4.5 4.5 0 0 1 0-9Z" fill="#3ddc84" />
            <rect x="3.5" y="7.5" width="17" height="9" rx="4.5" fill="none" stroke="#0b0b0c" strokeWidth="1.4" />
            <path d="M12 7.5v9" stroke="#0b0b0c" strokeWidth="1.4" />
          </g>
        </svg>
      ) : (
        <span className="wx-lp-initial" style={{ fontSize: Math.round(size * 0.58) }}>{name[0].toUpperCase()}</span>
      )}
    </span>
  );
}
