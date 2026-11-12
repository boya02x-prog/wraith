// GET /api/admin/street/logo -> the street-style ghost (owner only, 404 for everybody else). Original drawing.
import { NextRequest, NextResponse } from "next/server";
import { isOwner } from "@/lib/streetGate";

export const dynamic = "force-dynamic";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220">
<defs><pattern id="h" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="3.5" cy="3.5" r="1.7" fill="#0b0b0c"/></pattern></defs>
<path d="M100 22c-40 0-68 30-68 72v96l16-12 15 14 15-14 16 14 15-14 15 14 16-14 16 12V94c0-42-28-72-68-72Z" transform="translate(9 11)" fill="#0b0b0c"/>
<path d="M100 22c-40 0-68 30-68 72v96l16-12 15 14 15-14 16 14 15-14 15 14 16-14 16 12V94c0-42-28-72-68-72Z" fill="#f2ead8" stroke="#0b0b0c" stroke-width="7" stroke-linejoin="round"/>
<path d="M32 130c20 8 42 12 68 12s48-4 68-12v60l-16-12-16 14-15-14-15 14-16-14-15 14-15-14-16 12Z" fill="url(#h)" opacity=".55"/>
<path d="M60 84l34 12M140 84l-34 12" stroke="#0b0b0c" stroke-width="8" stroke-linecap="round"/>
<ellipse cx="74" cy="104" rx="9" ry="12" fill="#0b0b0c"/><ellipse cx="126" cy="104" rx="9" ry="12" fill="#0b0b0c"/>
<circle cx="71" cy="99" r="3" fill="#f2ead8"/><circle cx="123" cy="99" r="3" fill="#f2ead8"/>
<path d="M82 140q18 14 36 0" fill="#ff5a1f" stroke="#0b0b0c" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="128" y="12" width="46" height="30" rx="3" fill="#ff5a1f" stroke="#0b0b0c" stroke-width="5" transform="rotate(8 151 27)"/>
<text x="151" y="34" font-family="Impact,Anton,sans-serif" font-size="19" text-anchor="middle" fill="#0b0b0c" transform="rotate(8 151 27)">幽霊</text>
</svg>`;

export async function GET(req: NextRequest) {
  if (!(await isOwner(req))) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(SVG, { headers: { "content-type": "image/svg+xml", "cache-control": "private, no-store" } });
}
