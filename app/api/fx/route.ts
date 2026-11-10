import { NextRequest, NextResponse } from "next/server";
import { isDisplayCurrency } from "@/lib/currencies";

export async function GET(request: NextRequest) {
  const currency = request.nextUrl.searchParams.get("currency");
  if (!currency || !isDisplayCurrency(currency)) {
    return NextResponse.json(
      { error: "Unsupported display currency" },
      { status: 400 },
    );
  }

  if (currency === "USD") {
    return NextResponse.json(
      { currency, rate: 1, date: new Date().toISOString().slice(0, 10) },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
    );
  }

  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${currency}`,
      { next: { revalidate: 3600 } },
    );
    if (!response.ok) {
      return NextResponse.json(
        { error: "Exchange rate provider is unavailable" },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("rates" in payload) ||
      typeof payload.rates !== "object" ||
      payload.rates === null
    ) {
      return NextResponse.json(
        { error: "Exchange rate response was invalid" },
        { status: 502 },
      );
    }
    const rate = (payload.rates as Record<string, unknown>)[currency];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json(
        { error: "Exchange rate is unavailable" },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        currency,
        rate,
        date:
          "date" in payload && typeof payload.date === "string"
            ? payload.date
            : null,
      },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
    );
  } catch (error) {
    console.error("[FX rates]", error);
    return NextResponse.json(
      { error: "Exchange rate provider is unavailable" },
      { status: 502 },
    );
  }
}
