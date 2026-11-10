# Privy account wallets

WRAITH uses Privy's native Google OAuth login. Google sign-in, embedded
Solana/EVM wallet provisioning, and account sessions are managed by Privy;
WRAITH does not exchange credentials with another authentication provider.

## Required Privy settings

Set these in the local development environment and deployment environment:

```text
NEXT_PUBLIC_PRIVY_APP_ID=<Privy app ID>
PRIVY_APP_SECRET=<Privy app secret>
```

The app ID is public and is used by the browser SDK. The app secret is server
only; never add a `NEXT_PUBLIC_` prefix, commit it, or share it. In the Privy
dashboard, enable Google as a login method and enable embedded Solana and
Ethereum wallets. The public Google sign-in button is restricted to Google.

Restart the development server after changing environment variables. The
profile reports exactly which Privy setting is missing. The server verifies
Privy access tokens with the server SDK and associates Privy identities with
existing WRAITH MongoDB accounts by email where possible. A first-party,
HttpOnly session cookie is refreshed from the signed-in Privy session for
same-origin API requests.

## Wallets and supported actions

The EVM account address is shared across Base, Ethereum, BNB Chain, and Monad;
Solana has its own address. The profile shows wallet addresses and native
balances, supports receiving funds, and supports approved SOL transfers.
One-click live Solana buys use the embedded Solana signer. Paper funds remain
separate from wallet balances and transactions.

SPL/ERC-20 balances and transfers, fiat on-ramps, cross-chain transfers, and
EVM send flows are not provided. Embedded-wallet key export uses Privy's
secure flow.

## Local verification

1. Confirm the profile status says Privy is configured.
2. Sign in using the Privy Google dialog.
3. Wait for both embedded addresses to appear under **Wallets & balances**.
4. Confirm the top-right wallet chip displays the native SOL and Base balances.

Real Google OAuth and wallet provisioning require the configured Privy app and
dashboard settings; they cannot be validated in an unconfigured local browser.
