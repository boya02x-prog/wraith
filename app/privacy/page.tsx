import type { Metadata } from "next";
import { LegalPage, H } from "../legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="November 5, 2026">
      <p>Wraith (wraith.farm) is a multi-chain token scanner and trading app. This page explains what we collect and how it is used.</p>

      <H>What we collect</H>
      <p>When you sign in with Google, email or a wallet, authentication is handled by Privy. We receive your account identifier, your email address if you used one, your display name and profile picture from your sign-in provider, and your wallet address.</p>
      <p>We also store what you do in the app: paper and live trades, positions, watchlists, followed traders, intel you post, notification settings and your profile settings.</p>

      <H>How we use it</H>
      <p>We use this information to sign you in, run your account, show your portfolio and trade history, power leaderboards and profiles you choose to make public, send notifications you turn on, and keep the service secure. We do not sell your personal information.</p>

      <H>What is public</H>
      <p>Your username, avatar and intel posts can be seen by other users. Your trading stats are shown to others only if you turn public trading on in your profile.</p>

      <H>Service providers</H>
      <p>We rely on Privy for authentication and wallets, MongoDB for storage, Vercel for hosting, and third-party market data and analytics providers. They process data only to provide their service to us.</p>

      <H>Cookies and storage</H>
      <p>We use cookies and browser storage to keep you signed in and to remember your settings and cached screens on your device.</p>

      <H>Your choices</H>
      <p>You can edit your profile, switch off public trading and notifications, or ask us to delete your account and data by contacting us through the feedback option inside the app.</p>

      <H>Changes</H>
      <p>If we change this policy, the updated version will be posted here with a new date.</p>
    </LegalPage>
  );
}
