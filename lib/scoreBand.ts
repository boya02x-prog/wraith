// One plain-language reading of Wraith's 0-100 numbers, so "74" is never just a number.
export type Band = { label: string; color: string; hint: string };

/** Signal (opportunity) score: how strong the setup looks right now. */
export function signalBand(score: number): Band {
  if (score >= 80) return { label: "Strong", color: "#37d58a", hint: "Strong setup: momentum, volume and holders line up" };
  if (score >= 65) return { label: "Good", color: "#8bd65a", hint: "Good setup with a few things still to prove" };
  if (score >= 50) return { label: "Fair", color: "#ffba55", hint: "Mixed signals: watch it, do not chase" };
  if (score >= 35) return { label: "Weak", color: "#ff8a4c", hint: "Weak setup: most signals are missing" };
  return { label: "Risky", color: "#e5594a", hint: "Very weak setup: likely to fade" };
}

/** Safety score: higher is safer. Same scale as the signal score so the colors always mean the same thing. */
export function safetyBand(score: number): Band {
  if (score >= 75) return { label: "Low risk", color: "#37d58a", hint: "Most safety checks passed" };
  if (score >= 50) return { label: "Medium risk", color: "#ffba55", hint: "Some safety checks failed, read them before buying" };
  return { label: "High risk", color: "#e5594a", hint: "Several safety checks failed" };
}

/** Risk level from the number of risk flags a signal carries. */
export function riskLevel(risks: number): Band {
  if (risks === 0) return { label: "Low risk", color: "#37d58a", hint: "No risk flags" };
  if (risks <= 2) return { label: "Medium risk", color: "#ffba55", hint: "A few risk flags: check them" };
  return { label: "High risk", color: "#e5594a", hint: "Many risk flags" };
}
