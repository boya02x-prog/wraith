// Shared quick-buy preset store.
//
// Single source of truth for the paper-trading quick-buy amounts, so the
// header's Presets panel and the per-token QuickBuyRow (TokenHoverChart.tsx)
// stay in sync — editing a preset in one place is reflected everywhere,
// because both just read/write this same localStorage-backed store.

import { defaultCashAmounts, readCurrency } from "@/lib/cash";

export interface QuickBuyPreset {
  // amounts are CASH in the display currency (₱/$…), converted to SOL when the buy fires
  unit?: "cash";
  id: string;
  name: string;
  // Two fixed-SOL buy buttons. The 50%/100%-of-balance buttons are computed
  // live from the paper balance and aren't part of a saved preset.
  amounts: [number, number];
}

const PRESETS_KEY = "wraith_quickbuy_presets_v1";
const ACTIVE_KEY = "wraith_quickbuy_active_preset_v1";

export const DEFAULT_PRESETS: QuickBuyPreset[] = [
  { id: "preset-1", name: "Preset 1", unit: "cash", amounts: [5, 20] },
];

function isValidPreset(p: unknown): p is QuickBuyPreset {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    Array.isArray(r.amounts) &&
    r.amounts.length === 2 &&
    r.amounts.every((n) => typeof n === "number" && n > 0)
  );
}

export function loadPresets(): QuickBuyPreset[] {
  if (typeof window === "undefined") return DEFAULT_PRESETS;
  const fresh: QuickBuyPreset[] = [{ ...DEFAULT_PRESETS[0], amounts: defaultCashAmounts(readCurrency()) }];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(isValidPreset)
    ) {
      // old presets were SOL sizes; reset them to sensible cash sizes for the user's currency
      return (parsed as QuickBuyPreset[]).map((p) => (p.unit === "cash" ? p : { ...p, unit: "cash" as const, amounts: defaultCashAmounts(readCurrency()) }));
    }
    return DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

export function savePresets(presets: QuickBuyPreset[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.map((p) => ({ ...p, unit: "cash" }))));
  } catch {}
}

export function loadActivePresetId(): string {
  if (typeof window === "undefined") return DEFAULT_PRESETS[0].id;
  try {
    return localStorage.getItem(ACTIVE_KEY) || DEFAULT_PRESETS[0].id;
  } catch {
    return DEFAULT_PRESETS[0].id;
  }
}

export function saveActivePresetId(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {}
}

// Resolves the active preset, falling back to the first available preset if
// the stored active id no longer exists (e.g. that preset was deleted).
export function getActivePreset(): QuickBuyPreset {
  const presets = loadPresets();
  const activeId = loadActivePresetId();
  return presets.find((p) => p.id === activeId) ?? presets[0];
}

export function makePresetId(): string {
  return `preset-${Date.now().toString(36)}`;
}

// Convenience used by the inline pencil-editor on the hover-card quick-buy
// row: updates just the amounts on whichever preset is currently active,
// without needing the caller to know about the full preset list.
export function saveActivePresetAmounts(amounts: [number, number]) {
  const presets = loadPresets();
  const activeId = loadActivePresetId();
  const idx = presets.findIndex((p) => p.id === activeId);
  if (idx === -1) return;
  const next = [...presets];
  next[idx] = { ...next[idx], amounts };
  savePresets(next);
}
