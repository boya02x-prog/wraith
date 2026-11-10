"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useWraithSession } from "@/components/SessionProvider";
import { suggestUsername } from "@/lib/usernameUtils";

const DISMISSED_KEY = "wraith_username_modal_dismissed_v1";

export default function UsernameSetupModal() {
  const { data: session, status } = useWraithSession();
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Determine whether to show the modal
  useEffect(() => {
    if (status !== "authenticated") return;
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {}
    let active = true;
    fetch("/api/user/username")
      .then((r) => r.json())
      .then((data: { username?: string | null }) => {
        if (!active) return;
        if (!data.username) {
          // No username yet — suggest one and show modal
          const suggestion = suggestUsername(
            session?.user?.name ?? session?.user?.email ?? "trader",
          );
          setValue(suggestion);
          setShow(true);
          // Pre-check the suggestion
          checkAvailability(suggestion);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const checkAvailability = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) {
      setAvailable(null);
      setCheckError("");
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      setAvailable(null);
      setCheckError("");
      try {
        const r = await fetch(
          `/api/user/username/check?q=${encodeURIComponent(q)}`,
        );
        const data = await r.json();
        setAvailable(data.available ?? false);
        if (!data.available && data.error) setCheckError(data.error);
      } catch {
        setCheckError("Could not check availability.");
      } finally {
        setChecking(false);
      }
    }, 400);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
    setShow(false);
  };

  const handleChange = (v: string) => {
    setValue(v);
    setSubmitError("");
    checkAvailability(v);
  };

  const submit = async () => {
    if (!available || busy) return;
    setBusy(true);
    setSubmitError("");
    try {
      const r = await fetch("/api/user/username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value }),
      });
      const data = await r.json();
      if (!r.ok) {
        setSubmitError(data.error ?? "Could not save username.");
        setBusy(false);
        return;
      }
      try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
      setShow(false);
    } catch {
      setSubmitError("Something went wrong. Try again.");
      setBusy(false);
    }
  };

  if (!show) return null;

  const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, "");

  return (
    <div className="username-modal-backdrop" onClick={dismiss}>
      <div
        className="username-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose your username"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="username-modal-close"
          onClick={dismiss}
          aria-label="Skip for now"
        >
          <X size={15} />
        </button>

        <div className="username-modal-eyebrow">WRAITH · IDENTITY</div>
        <h2 className="username-modal-title">Choose your @username</h2>
        <p className="username-modal-body">
          Your unique handle — others can search and follow you by it.
          You can change it later in your profile settings.
        </p>

        <div className="username-modal-field">
          <div className="username-modal-input-wrap">
            <span className="username-modal-at">@</span>
            <input
              ref={inputRef}
              type="text"
              className="username-modal-input"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") dismiss();
              }}
              placeholder="your_handle"
              maxLength={20}
              autoFocus
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="username-modal-status">
              {checking && <Loader2 size={14} className="spinning" />}
              {!checking && available === true && (
                <Check size={14} style={{ color: "var(--win)" }} />
              )}
              {!checking && available === false && (
                <X size={14} style={{ color: "var(--loss)" }} />
              )}
            </div>
          </div>
          {normalized !== value && value.length > 0 && (
            <div className="username-modal-hint">
              Will be saved as: @{normalized}
            </div>
          )}
          {checkError && (
            <div className="username-modal-error">{checkError}</div>
          )}
          {submitError && (
            <div className="username-modal-error">{submitError}</div>
          )}
          {available === true && !checking && (
            <div className="username-modal-ok">@{normalized} is available</div>
          )}
        </div>

        <div className="username-modal-actions">
          <button
            type="button"
            className="username-modal-skip"
            onClick={dismiss}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="username-modal-confirm"
            disabled={!available || busy || checking}
            onClick={() => void submit()}
          >
            {busy ? (
              <Loader2 size={14} className="spinning" />
            ) : (
              "Claim @" + (normalized || "username")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
