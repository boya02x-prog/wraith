"use client";

// The "Avatar border" section of Edit profile: every border drawn around the person's own photo, so they see exactly what they get.
// Event borders can be picked only while their event is on (the server checks it too); once picked they stay.
import { Check } from "lucide-react";
import Frame from "@/components/Frame";
import { FRAMES, frameBack, frameOpen, type FrameDef } from "@/lib/frames";

export default function FramePicker({ value, photo, onChange }: { value: string; photo: string; onChange: (id: string) => void }) {
  const tile = (f: FrameDef) => {
    const open = frameOpen(f) || value === f.id;
    const on = value === f.id;
    return (
      <button key={f.id} type="button" className={`fp-tile${on ? " on" : ""}${open ? "" : " locked"}`} disabled={!open} aria-pressed={on} onClick={() => onChange(f.id)}>
        <Frame id={f.id} thick={3} className="fp-av">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" draggable={false} />
        </Frame>
        <b>{f.label}</b>
        <small>{open ? f.hint : frameBack(f)}</small>
        {on && <i className="fp-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></i>}
      </button>
    );
  };
  return (
    <div className="fp">
      <div className="fp-head">
        <strong>Avatar border</strong>
        <small>Glows around your photo on the leaderboard, your profile and in search.</small>
      </div>
      <div className="fp-grid">{FRAMES.filter((f) => !f.event).map(tile)}</div>
      <div className="fp-sub">Events</div>
      <div className="fp-grid">{FRAMES.filter((f) => f.event).map(tile)}</div>
    </div>
  );
}
