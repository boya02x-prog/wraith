"use client";
// When the connection drops the screen stays exactly as it is (nothing is thrown away); a thin bar says so, and goes when the connection is back.
// What you do meanwhile needs the connection, so it will not go through until then.
import { useEffect, useState } from "react";

export default function OfflineBar() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const up = () => setOff(false), down = () => setOff(true);
    void Promise.resolve().then(() => { if (navigator.onLine === false) setOff(true); });
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  if (!off) return null;
  return (
    <div role="status" style={{ position: "fixed", left: 0, right: 0, top: "calc(var(--sai-top, 0px) + 52px)", zIndex: 78, display: "flex", justifyContent: "center", gap: 10, padding: "7px 12px", background: "#3a2a0c", color: "#ffd38a", font: "700 13px var(--font-sans)" }}>
      <span>No connection. You can look around; trades and changes wait until it is back.</span>
    </div>
  );
}
