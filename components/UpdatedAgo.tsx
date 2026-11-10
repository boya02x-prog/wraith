"use client";

import { memo, useEffect, useState } from "react";

/**
 * "12" = seconds since `at`. Ticks by itself, so the list around it never re-renders just to move a clock
 * (that used to re-render every card on the board once a second). Pauses while the tab is hidden.
 */
function UpdatedAgoBase({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) tick((n) => n + 1); }, 1000);
    return () => window.clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.round((Date.now() - at) / 1000))}</>;
}

export const UpdatedAgo = memo(UpdatedAgoBase);
