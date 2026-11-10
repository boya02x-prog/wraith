import type { Metadata } from "next";
import { LegalPage, H } from "../legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="November 5, 2026">
      <p>By using Wraith (wraith.farm) you agree to these terms. If you do not agree, do not use the service.</p>

      <H>What Wraith is</H>
      <p>Wraith is a tool for discovering and tracking tokens across chains, with paper trading and optional live trading. It provides market data and automated checks for information only.</p>

      <H>Not financial advice</H>
      <p>Nothing in Wraith is financial, investment or legal advice. Safety scores, analysis and signals are automated and can be wrong. Early-stage tokens are extremely volatile and you can lose everything you put in. You are responsible for your own decisions.</p>

      <H>Your account and wallet</H>
      <p>You are responsible for your account and for keeping your sign-in and wallet secure. You must be old enough to use crypto services where you live and follow the laws that apply to you.</p>

      <H>Fees</H>
      <p>Live trades made through Wraith may carry a fee, which is shown before you confirm. Network fees and token taxes are charged by the blockchain and the token, not by us.</p>

      <H>Acceptable use</H>
      <p>Do not abuse the service, attempt to break or overload it, scrape it at scale, post unlawful or misleading content, or manipulate leaderboards.</p>

      <H>Availability and liability</H>
      <p>The service is provided as is, without warranties. We may change or stop features at any time. To the extent the law allows, Wraith is not liable for trading losses, failed or delayed transactions, data errors or downtime.</p>

      <H>Changes</H>
      <p>We may update these terms. Continuing to use Wraith after a change means you accept the new terms.</p>
    </LegalPage>
  );
}
