"use client";
// Tells the server once a minute that this signed-in user has the app open and visible (the admin's "online now" count).
import { useEffect } from "react";

export default function PresenceBeat() {
  useEffect(() => {
    const beat = () => { if (document.visibilityState === "visible") void fetch("/api/presence", { method: "POST", keepalive: true }).catch(() => undefined); };
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    beat();
    const timer = window.setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return null;
}
