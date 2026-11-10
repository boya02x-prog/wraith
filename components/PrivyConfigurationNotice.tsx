"use client";

import { useEffect, useState } from "react";

export default function PrivyConfigurationNotice() {
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/privy-status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load Privy configuration status.");
        }
        const payload: unknown = await response.json();
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("missing" in payload) ||
          !Array.isArray(payload.missing) ||
          !payload.missing.every((key) => typeof key === "string")
        ) {
          throw new Error("Privy configuration response was invalid.");
        }
        if (active) setMissing(payload.missing);
      })
      .catch((error) => {
        console.error("[Privy configuration notice]", error);
        if (active) setMissing(["PRIVY CONFIGURATION STATUS"]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="wraith-setup-notice" role="status">
      {missing === null
        ? "Checking Privy configuration…"
        : missing.length
          ? `Privy is not configured. Missing: ${missing.join(", ")}.`
          : "Privy is configured. Sign in with Google to load your account wallets."}
    </div>
  );
}
