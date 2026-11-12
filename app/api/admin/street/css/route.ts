// GET /api/admin/street/css -> the street theme stylesheet (owner only, 404 for everybody else). Original art direction:
// ink-black, bone and ember, thick outlines, hard offset shadows, halftone dots, poster type.
import { NextRequest, NextResponse } from "next/server";
import { isOwner } from "@/lib/streetGate";

export const dynamic = "force-dynamic";

const CSS = `
html[data-street] {
  --accent-rgb: 255, 90, 31; --accent: #ff5a1f; --accent-text: #ff8a55;
  --street-ink: #0b0b0c; --street-bone: #f2ead8; --street-shadow: 4px 4px 0 #0b0b0c;
}
html[data-street] body { background-color: #141211 !important; background-image: radial-gradient(rgba(242,234,216,.07) 1.2px, transparent 1.4px) !important; background-size: 9px 9px !important; }
html[data-street] h1, html[data-street] h2, html[data-street] .wraith-profile-menu-label, html[data-street] .dt-tabs button {
  font-family: var(--font-display), Impact, sans-serif !important; text-transform: uppercase; letter-spacing: .04em; }
html[data-street] .wraith-dashboard button, html[data-street] .wraith-terms-continue {
  border: 2px solid var(--street-ink) !important; box-shadow: var(--street-shadow); border-radius: 6px !important; transition: transform .08s, box-shadow .08s; }
html[data-street] .wraith-dashboard button:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--street-ink); }
html[data-street] .wx-chart-card, html[data-street] .callout-card, html[data-street] .hl, html[data-street] .dt, html[data-street] .wraith-profile-menu,
html[data-street] .wraith-terms-dialog, html[data-street] .wx-mbar {
  border: 2px solid var(--street-bone) !important; border-radius: 8px !important; box-shadow: 6px 6px 0 var(--street-ink); background-color: #1b1917 !important; }
html[data-street] .callout-card { box-shadow: 4px 4px 0 var(--street-ink); }
html[data-street] .callout-mcap-badge { background: var(--accent) !important; color: var(--street-ink) !important; border: 2px solid var(--street-ink); border-radius: 4px; transform: rotate(-2deg); }
html[data-street] .wraith-app-header { border-bottom: 3px solid var(--street-bone) !important; background-color: #0b0b0c !important; }
html[data-street] .wraith-app-header img[src*="logo"] { content: url(/api/admin/street/logo); height: 38px !important; width: auto !important; filter: none !important; }
html[data-street] .dt-tabs button.on { background: var(--street-bone) !important; color: var(--street-ink) !important; border-radius: 4px !important; }
html[data-street] .hl-row { border-top: 2px dashed rgba(242,234,216,.18); }
html[data-street] .up { color: #7bff6b !important; } html[data-street] .dn { color: #ff4d4d !important; }
html[data-street] ::selection { background: var(--accent); color: var(--street-ink); }
`;

export async function GET(req: NextRequest) {
  if (!(await isOwner(req))) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "private, no-store" } });
}
