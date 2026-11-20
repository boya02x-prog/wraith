import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import HumanCheck from "@/components/HumanCheck";
import { HUMAN_COOKIE, humanGateOn, readHuman, safeNext, turnstileSiteKey } from "@/lib/humanGate";

export const metadata: Metadata = { title: "Checking you are human", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic"; // reads the cookie and the keys on every request

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  // nothing to check (keys not set) or already passed: straight on
  if (!humanGateOn() || (await readHuman((await cookies()).get(HUMAN_COOKIE)?.value))) redirect(next);
  return <HumanCheck siteKey={turnstileSiteKey()} next={next} />;
}
