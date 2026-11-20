"use client";

// One photo viewer for the whole app. Put `data-zoom` on any image (or on an element that has a background picture) and a tap opens it full
// screen (PhotoViewer: pinch to zoom, drag down or tap outside to close). It works in the capture phase, so it also wins over a link or a
// card the picture sits inside: tapping a profile photo in search, on a poster or on someone's page shows the photo instead of opening the page.
// Optional: data-zoom-src="..." when the picture to show differs from the one drawn (a small thumbnail, for example).
import { useEffect, useState } from "react";
import PhotoViewer from "@/components/PhotoViewer";

function sourceOf(el: HTMLElement): string {
  const explicit = el.getAttribute("data-zoom-src");
  if (explicit) return explicit;
  if (el instanceof HTMLImageElement) return el.currentSrc || el.src;
  const bg = getComputedStyle(el).backgroundImage;
  const m = /url\(["']?(.*?)["']?\)\s*(?:,|$)/.exec(bg);
  return m ? m[1] : "";
}

export default function PhotoZoomHost() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const el = target?.closest?.("[data-zoom]") as HTMLElement | null;
      if (!el) return;
      const url = sourceOf(el);
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      setSrc(url);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return src ? <PhotoViewer src={src} onClose={() => setSrc(null)} /> : null;
}
