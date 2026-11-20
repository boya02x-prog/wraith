"use client";
// Wraith's own 3D character, in two sizes.
//  <GhostScene />  the big banner for hero spots (the Wins screen): a crowned ghost with a gold coin on the winners' podium in a spotlight, drawn live in 3D
//                  (components/Wraith3D.tsx) over a still picture of the same scene, so it is never empty and works on phones that cannot do 3D.
//  <GhostMini />   a still of the ghost for empty and error states: asleep by default, "oops" for errors, waving for a welcome.
import Wraith3D, { WINS_SCENE } from "@/components/Wraith3D";

export default function GhostScene({ title, subtitle, height = 210 }: { title: string; subtitle?: string; height?: number }) {
  return (
    <div className="gs" style={{ height }} role="img" aria-label={title}>
      <Wraith3D {...WINS_SCENE} poster="/mascot/wraith-king.webp" />
      <div className="gs-copy"><b>{title}</b>{subtitle ? <small>{subtitle}</small> : null}</div>
    </div>
  );
}

export function GhostMini({ size = 54, pose = "sleep" }: { size?: number; pose?: "sleep" | "oops" | "wave" }) {
  return (
    <div className="gm" aria-hidden="true" style={{ width: size * 1.7, height: size * 1.5 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/mascot/wraith-${pose}.webp`} alt="" style={{ height: size * 1.4 }} draggable={false} />
      {pose === "sleep" && <><span className="z1">z</span><span className="z2">z</span><span className="z3">Z</span></>}
    </div>
  );
}
