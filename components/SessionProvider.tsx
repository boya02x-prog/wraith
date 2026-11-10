"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useIdentityToken,
  useLoginWithOAuth,
  useOAuthTokens,
  usePrivy,
} from "@privy-io/react-auth";
import { PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";
import { clearUserCaches } from "@/lib/profileCache";

export interface WraithSession {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
}

export interface WraithSessionState {
  data: WraithSession | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: () => void;
  reauthenticateGoogle: () => Promise<void>;
  syncAppSession: () => Promise<string | null>;
  logout: () => Promise<void>;
}

const WraithSessionContext = createContext<WraithSessionState | null>(null);

function readSessionImage(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("user" in payload) ||
    typeof payload.user !== "object" ||
    payload.user === null ||
    !("image" in payload.user)
  ) {
    throw new Error("The app session response did not include a user image.");
  }
  if (payload.user.image !== null && typeof payload.user.image !== "string") {
    throw new Error("The app session response contained an invalid user image.");
  }
  return payload.user.image;
}

export function WraithAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return PRIVY_WALLETS_ENABLED ? (
    <PrivySessionProvider>{children}</PrivySessionProvider>
  ) : (
    <UnavailableSessionProvider>{children}</UnavailableSessionProvider>
  );
}

export function useWraithSession(): WraithSessionState {
  const session = useContext(WraithSessionContext);
  if (!session) {
    throw new Error("useWraithSession must be used inside WraithAuthProvider.");
  }
  return session;
}

function PrivySessionProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken } =
    usePrivy();
  const { initOAuth } = useLoginWithOAuth();
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const { identityToken } = useIdentityToken();
  const identityTokenRef = useRef<string | null>(null);
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  useEffect(() => {
    identityTokenRef.current = identityToken ?? null;
  }, [identityToken]);
  const { reauthorize } = useOAuthTokens();
  const syncAppSession = useCallback(async () => {
    const accessToken = await getAccessTokenRef.current();
    if (!accessToken) {
      throw new Error("Privy session credentials are not ready yet.");
    }
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      if (response.status === 403) {
        // private mode: this account is signed in with Google but is not on the allowed list
        const body = (await response.json().catch(() => null)) as { error?: string; yourId?: string } | null;
        if (body?.error === "Private") {
          throw new Error(`This site is private and this account is not on the list.${body.yourId ? ` Account id: ${body.yourId}` : ""}`);
        }
      }
      throw new Error(
        `Could not establish the app session (${response.status}).`,
      );
    }
    return readSessionImage(await response.json());
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user?.id) {
      setProfileImage(null);
      return;
    }
    let active = true;
    void syncAppSession()
      .then((image) => {
        if (active) setProfileImage(image);
      })
      .catch((error) => {
        if (active) console.error("[Privy session profile]", error);
      });
    return () => {
      active = false;
    };
  }, [authenticated, ready, syncAppSession, user?.id]);
  const googleAccount = user?.linkedAccounts.find(
    (account) => account.type === "google_oauth",
  );
  const emailAccount = user?.linkedAccounts.find(
    (account) => account.type === "email",
  );
  const name =
    googleAccount?.type === "google_oauth" ? googleAccount.name : null;
  const email =
    (googleAccount?.type === "google_oauth" ? googleAccount.email : null) ??
    (emailAccount?.type === "email" ? emailAccount.address : null);

  // Keep the session object's identity stable. It used to be rebuilt on every render, so every effect that depended on
  // `session.user` re-ran each time Privy updated anything, refetching the profile (up to ~1 MB) over and over.
  const userId = user?.id ?? null;
  const sessionData = useMemo<WraithSession | null>(
    () =>
      authenticated && userId
        ? { user: { id: userId, name, email, image: profileImage } }
        : null,
    [authenticated, userId, name, email, profileImage],
  );

  const session: WraithSessionState = {
    data: sessionData,
    status: !ready
      ? "loading"
      : authenticated
        ? "authenticated"
        : "unauthenticated",
    // Go straight to Google (skips Privy's own sign-in window); fall back to it on error.
    login: () => {
      void initOAuth({ provider: "google" }).catch((error: unknown) => {
        console.warn("[auth] direct Google sign-in failed, opening Privy modal", error);
        login();
      });
    },
    reauthenticateGoogle: () => reauthorize({ provider: "google" }),
    syncAppSession,
    logout: async () => {
      clearUserCaches();
      await logout();
      await fetch("/api/auth/session", { method: "DELETE" });
    },
  };
  return (
    <WraithSessionContext.Provider value={session}>
      {children}
    </WraithSessionContext.Provider>
  );
}

function UnavailableSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const session: WraithSessionState = {
    data: null,
    status: "unauthenticated",
    login: () => {
      console.error("[Privy auth] NEXT_PUBLIC_PRIVY_APP_ID is not configured.");
    },
    reauthenticateGoogle: async () => {
      throw new Error("Privy is not configured for Google reauthentication.");
    },
    syncAppSession: async () => {
      throw new Error("Privy is not configured for app authentication.");
    },
    logout: async () => {
      await fetch("/api/auth/session", { method: "DELETE" });
    },
  };
  return (
    <WraithSessionContext.Provider value={session}>
      {children}
    </WraithSessionContext.Provider>
  );
}
