// app/api/telegram/stale/route.ts
import { featureTier } from "@/lib/launchSettingsServer";
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import { esc, fmtUsd, footer, header, rule } from "@/lib/telegramUi";
import { checkLimit, lightWriteLimiter } from "@/lib/ratelimit";

async function send(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // this sends to the caller's own linked chat only, but it is still an outbound message per request, so it gets a budget
  const rl = await checkLimit(lightWriteLimiter, `stale:${session.user.id}`);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const symbol = typeof body.symbol === "string" ? body.symbol.slice(0, 32) : "TOKEN";
  const initialMcap = num(body.initialMcap);
  const currentMcap = num(body.currentMcap);
  const seenAt = num(body.seenAt);
  const contractAddress = typeof body.contractAddress === "string" && /^[A-Za-z0-9]{32,44}$/.test(body.contractAddress) ? body.contractAddress : "";
  if (!seenAt) return NextResponse.json({ skipped: true });

  // Only send stale alert if token is 20+ mins old and below 1.5x
  const ageMs = Date.now() - seenAt;
  const xNow = initialMcap > 0 ? currentMcap / initialMcap : 0;

  if (ageMs < 20 * 60 * 1000 || xNow >= 1.5) {
    return NextResponse.json({ skipped: true });
  }

  const db = await getDb();
  const user = await db
    .collection("users")
    .findOne(
      { _id: new (require("mongodb").ObjectId)(session.user.id) },
      { projection: { telegramChatId: 1, tier: 1, tierSource: 1 } },
    );

  if (!user?.telegramChatId) {
    return NextResponse.json({ error: "No Telegram linked" }, { status: 400 });
  }

  const eligibleTiers = ["SPECTER", "WRAITH"];
  if (!eligibleTiers.includes(await featureTier(user as { tier?: unknown; tierSource?: unknown }))) {
    return NextResponse.json({ error: "Tier not eligible" }, { status: 403 });
  }

  const fmtMcap = (n: number) => {
    if (!n) return "—";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const xStr = xNow >= 10 ? `${xNow.toFixed(1)}x` : `${xNow.toFixed(2)}x`;
  const ageMin = Math.floor(ageMs / 60_000);

  const chain: string = typeof body.chain === "string" ? body.chain.slice(0, 20) : "solana";
  let msg = header("☠️", "STALE · NO PROGRESS", symbol, chain);
  msg += `\n📉 <b>Entry</b>  ${fmtUsd(initialMcap)}  →  <b>Now</b>  ${fmtUsd(currentMcap)}  (${xStr})`;
  msg += `\n⏱ <b>${ageMin}m</b> with no meaningful move`;
  if (contractAddress) msg += `\n${rule}\n<code>${esc(contractAddress)}</code>`;
  msg += `\n\n${footer}`;

  try {
    await send(user.telegramChatId, msg);
  } catch (err) {
    console.error("[telegram stale]", err);
    return NextResponse.json({ error: "Could not send" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
