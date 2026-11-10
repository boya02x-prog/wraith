"use client";

// One flowing feed for the profile: Following (traders you follow) and My intel, switched by tabs.

import { useState } from "react";
import FollowingIntelSidebar from "@/components/FollowingIntelSidebar";
import ProfileCallouts from "@/components/ProfileCallouts";

type Tab = "following" | "mine";

export default function ProfileFeed({ userId }: { userId?: string | null }) {
  const [tab, setTab] = useState<Tab>("following");
  const active: Tab = userId ? tab : "following";

  return (
    <div className="fp-feed">
      <div className="fp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={active === "following"} className={active === "following" ? "on" : ""} onClick={() => setTab("following")}>
          Following
        </button>
        {userId && (
          <button type="button" role="tab" aria-selected={active === "mine"} className={active === "mine" ? "on" : ""} onClick={() => setTab("mine")}>
            My intel
          </button>
        )}
      </div>
      {active === "following" ? <FollowingIntelSidebar embedded /> : userId ? <ProfileCallouts userId={userId} /> : null}
    </div>
  );
}
