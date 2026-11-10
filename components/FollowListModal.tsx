"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, UserCheck, UserPlus, X } from "lucide-react";
import { useWraithSession } from "@/components/SessionProvider";

type ListUser = {
  userId: string;
  username: string | null;
  displayName: string;
  avatarDataUrl: string;
  isFollowing: boolean;
  isSelf: boolean;
};

type Props = {
  traderId: string;
  initialTab: "followers" | "following";
  followerCount: number;
  followingCount: number;
  onClose: () => void;
};

export default function FollowListModal({
  traderId,
  initialTab,
  followerCount,
  followingCount,
  onClose,
}: Props) {
  const { data: session } = useWraithSession();
  const [tab, setTab] = useState<"followers" | "following">(initialTab);
  const [users, setUsers] = useState<ListUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [searchQ, setSearchQ] = useState("");
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});
  const [followBusy, setFollowBusy] = useState<Record<string, boolean>>({});
  const limit = 20;
  const backdropRef = useRef<HTMLDivElement>(null);

  const loadUsers = useCallback(
    async (currentTab: "followers" | "following", currentOffset: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          traderId,
          type: currentTab,
          limit: String(limit),
          offset: String(currentOffset),
        });
        const r = await fetch(`/api/traders/followers?${params.toString()}`);
        const data = await r.json();
        const loaded: ListUser[] = Array.isArray(data.users) ? data.users : [];
        setUsers((prev) =>
          currentOffset === 0 ? loaded : [...prev, ...loaded],
        );
        setTotal(typeof data.total === "number" ? data.total : 0);
        const states: Record<string, boolean> = {};
        for (const u of loaded) states[u.userId] = u.isFollowing;
        setFollowStates((prev) => ({ ...prev, ...states }));
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    },
    [traderId],
  );

  useEffect(() => {
    setUsers([]);
    setOffset(0);
    void loadUsers(tab, 0);
  }, [tab, loadUsers]);

  const handleFollow = async (userId: string, isFollowing: boolean) => {
    if (!session?.user?.id) return;
    setFollowBusy((prev) => ({ ...prev, [userId]: true }));
    setFollowStates((prev) => ({ ...prev, [userId]: !isFollowing }));
    try {
      if (isFollowing) {
        await fetch(
          `/api/traders/following?traderId=${encodeURIComponent(userId)}`,
          { method: "DELETE" },
        );
      } else {
        await fetch("/api/traders/following", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traderId: userId }),
        });
      }
    } catch {
      setFollowStates((prev) => ({ ...prev, [userId]: isFollowing }));
    } finally {
      setFollowBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const filtered = searchQ.trim()
    ? users.filter(
        (u) =>
          u.displayName.toLowerCase().includes(searchQ.toLowerCase()) ||
          u.username?.toLowerCase().includes(searchQ.toLowerCase()),
      )
    : users;

  const hasMore = users.length < total;

  return (
    <div
      ref={backdropRef}
      className="follow-modal-backdrop"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="follow-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="follow-modal-head">
          <div className="follow-modal-tabs">
            <button
              type="button"
              className={tab === "followers" ? "on" : ""}
              onClick={() => setTab("followers")}
            >
              <strong>{followerCount}</strong> Followers
            </button>
            <button
              type="button"
              className={tab === "following" ? "on" : ""}
              onClick={() => setTab("following")}
            >
              <strong>{followingCount}</strong> Following
            </button>
          </div>
          <button
            type="button"
            className="follow-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="follow-modal-search-wrap">
          <Search size={13} />
          <input
            type="text"
            className="follow-modal-search"
            placeholder="Search by name or @username…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>

        {/* List */}
        <div className="follow-modal-list">
          {loading && offset === 0 ? (
            <div className="follow-modal-empty">
              <Loader2 size={18} className="spinning" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="follow-modal-empty">
              {searchQ
                ? "No results for that search."
                : tab === "followers"
                  ? "No followers yet."
                  : "Not following anyone yet."}
            </div>
          ) : (
            filtered.map((user) => {
              const href = user.username
                ? `/app/u/${user.username}`
                : `/app/u/${user.userId}`;
              const isFollowing = followStates[user.userId] ?? user.isFollowing;
              return (
                <div key={user.userId} className="follow-modal-row">
                  <Link href={href} onClick={onClose} className="follow-modal-user">
                    {user.avatarDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={user.avatarDataUrl}
                        alt=""
                        className="follow-modal-avatar"
                      />
                    ) : (
                      <span className="follow-modal-avatar-fallback">
                        {user.displayName.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="follow-modal-user-info">
                      <span className="follow-modal-name">{user.displayName}</span>
                      {user.username && (
                        <span className="follow-modal-handle">@{user.username}</span>
                      )}
                    </div>
                  </Link>
                  {session?.user?.id && !user.isSelf && user.userId !== session.user.id && (
                    <button
                      type="button"
                      className={`follow-modal-follow-btn${isFollowing ? " following" : ""}`}
                      disabled={followBusy[user.userId]}
                      onClick={() => void handleFollow(user.userId, isFollowing)}
                    >
                      {followBusy[user.userId] ? (
                        <Loader2 size={13} className="spinning" />
                      ) : isFollowing ? (
                        <><UserCheck size={13} /> Following</>
                      ) : (
                        <><UserPlus size={13} /> Follow</>
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}
          {hasMore && !loading && (
            <button
              type="button"
              className="follow-modal-more"
              onClick={() => {
                const next = offset + limit;
                setOffset(next);
                void loadUsers(tab, next);
              }}
            >
              Load more
            </button>
          )}
          {loading && offset > 0 && (
            <div className="follow-modal-empty">
              <Loader2 size={16} className="spinning" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
