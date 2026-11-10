"use client";

import { useEffect, type MutableRefObject } from "react";
import { useLinkAccount, useUnlinkOAuth } from "@privy-io/react-auth";

// Gives the profile page access to Privy's "link X" and "unlink X". It lives in its own component because these two hooks
// only work inside <PrivyProvider>: the profile page renders it only when Privy is configured, so a build or preview
// without Privy keys still works.
export type XLinkApi = {
  link: () => void;
  unlink: (subject: string) => Promise<void>;
};

export default function XLinkBridge({
  apiRef,
  onLinked,
  onError,
}: {
  apiRef: MutableRefObject<XLinkApi | null>;
  onLinked: () => void;
  onError: (reason: string) => void;
}) {
  const { linkTwitter } = useLinkAccount({
    onSuccess: ({ linkMethod }) => {
      if (String(linkMethod) === "twitter") onLinked();
    },
    onError: (code) => onError(String(code)),
  });
  const { unlink } = useUnlinkOAuth();

  useEffect(() => {
    apiRef.current = {
      link: () => linkTwitter(),
      unlink: async (subject: string) => {
        await unlink({ provider: "twitter", subject });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, linkTwitter, unlink]);

  return null;
}
