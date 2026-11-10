import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get("ids");
  if (!ids) return NextResponse.json({ error: "missing ids" }, { status: 400 });

  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 5 },
    });
    if (!res.ok) return NextResponse.json({}, { status: 200 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
