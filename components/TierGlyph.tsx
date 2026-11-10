import { useId, type CSSProperties } from "react";
import { GLYPH_VIEWBOX, tierGlyphInner, type GlyphTier } from "@/lib/tierGlyph";

const [, , VW, VH] = GLYPH_VIEWBOX.split(" ").map(Number);

/** The Wraith ghost, recoloured per tier. `size` is the rendered height in px. */
export default function TierGlyph({
  tier,
  size = 24,
  className,
  style,
}: {
  tier: GlyphTier;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const uid = "tg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={GLYPH_VIEWBOX}
      width={(size * VW) / VH}
      height={size}
      role="img"
      aria-label={`${tier} tier`}
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: tierGlyphInner(tier, uid) }}
    />
  );
}
