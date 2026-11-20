import type { CSSProperties, ReactNode } from "react";
import { frameOf } from "@/lib/frames";

/**
 * A photo with the trader's chosen border around it (lib/frames.ts has the list, app/wraith-frames.css the look). The ring and the glow are
 * drawn outside the child, so the child keeps its own size: wrap any round avatar. "none" draws nothing.
 */
export default function Frame({ id, thick, className, children }: { id?: string | null; thick?: number; className?: string; children: ReactNode }) {
  const f = frameOf(id);
  const style = thick ? ({ "--w": `${thick}px` } as CSSProperties) : undefined;
  return (
    <span className={`fr fr-${f.id}${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </span>
  );
}

/** Sets --frc (the border's colour) on a card, so the card can glow softly in the colour its owner picked. Nothing for a plain border. */
export function frameGlow(id?: string | null): CSSProperties | undefined {
  const f = frameOf(id);
  return f.id === "none" ? undefined : ({ "--frc": f.color } as CSSProperties);
}
