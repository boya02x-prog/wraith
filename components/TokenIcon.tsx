// components/TokenIcon.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/theme";
import { resolvePumpImage, peekPumpImage } from "@/lib/resolvePumpImage";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

function buildCandidates(
  dexImageUrl?: string,
  resolvedPumpUrl?: string | null,
) {
  const list: string[] = [];
  if (dexImageUrl) list.push(dexImageUrl);
  if (resolvedPumpUrl) list.push(resolvedPumpUrl);
  return list;
}

const PALETTE = [C.orange, C.purple, C.blue, C.green, C.yellow, "#ff4500"];

export function TokenIcon({
  contractAddress,
  imageUrl,
  symbol,
  size = 34,
}: {
  contractAddress?: string;
  imageUrl?: string;
  symbol: string;
  size?: number;
}) {
  // DexScreener image is passed in directly (imageUrl). If missing, we
  // resolve pump.fun's image_uri ourselves and cache it globally so this
  // fetch only ever happens once per mint across the whole app.
  const [pumpImage, setPumpImage] = useState<{
    address: string;
    url: string | null | undefined;
  } | null>(() => contractAddress
    ? { address: contractAddress, url: peekPumpImage(contractAddress) }
    : null);
  const pumpUrl = pumpImage && pumpImage.address === contractAddress ? pumpImage.url : undefined;

  useEffect(() => {
    if (!contractAddress) return;
    if (pumpImage?.address === contractAddress && pumpImage.url !== undefined) return;
    let cancelled = false;
    resolvePumpImage(contractAddress).then((url) => {
      if (!cancelled) setPumpImage({ address: contractAddress, url });
    });
    return () => {
      cancelled = true;
    };
  }, [contractAddress, pumpImage]);

  const candidates = useMemo(
    () => buildCandidates(imageUrl, pumpUrl),
    [imageUrl, pumpUrl],
  );
  const sourceKey = `${contractAddress || ""}:${imageUrl || ""}`;
  const [failedSource, setFailedSource] = useState<{
    key: string;
    count: number;
  } | null>(null);
  const idx = failedSource?.key === sourceKey ? failedSource.count : 0;
  const letter = (symbol || "?").charAt(0).toUpperCase();
  const src = candidates[idx];

  if (src) {
    return (
      <img
        src={src}
        alt={symbol}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailedSource({ key: sourceKey, count: idx + 1 })}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid #2a2a2a",
          background: "#111",
        }}
      />
    );
  }

  // Nothing resolved yet (still fetching) or every candidate 404'd —
  // generated letter avatar, same as before.
  const bg = PALETTE[letter.charCodeAt(0) % PALETTE.length];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `${bg}1a`,
        border: `1px solid ${bg}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: bg,
        fontSize: size * 0.38,
        fontWeight: 900,
        ...MONO,
      }}
    >
      {letter}
    </div>
  );
}
