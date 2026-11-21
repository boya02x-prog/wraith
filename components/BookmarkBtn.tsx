"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { readTokenFavorites, toggleTokenFavorite, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";

/** One-click save / unsave straight from any token row, drawn as a star (the same star as the "Saved" bar, so saving looks the same everywhere). Stays in sync with every other save button on the page. */
export default function BookmarkBtn({ meme, size = 15 }: { meme: MemeTrend; size?: number }) {
  const addr = meme.contractAddress ?? "";
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readTokenFavorites().some((f) => f.contractAddress === addr));
    sync();
    window.addEventListener(TOKEN_FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(TOKEN_FAVORITES_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [addr]);
  if (!addr) return null;
  return (
    <button
      type="button"
      className={`bm${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={on ? `Remove ${meme.keyword} from saved` : `Save ${meme.keyword}`}
      title={on ? "Saved. Click to remove" : "Save token"}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleTokenFavorite(meme); }}
    >
      <Star size={size} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
