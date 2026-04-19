/**
 * Gloss brand mark — 8-ray burst inside a deep-purple gradient tile.
 * Scales gracefully from wordmark size (~20px) up through the hero
 * block (~64px); stroke/radius tuned by size.
 */
export function GlossLogo({ size = 20 }: { size?: number }) {
  const glyph = Math.round(size * 0.5);
  const strokeW = size <= 20 ? 1.8 : size <= 28 ? 1.6 : size <= 48 ? 1.5 : 1.4;
  const radius = Math.round(size * 0.25);
  return (
    <span
      className="flex-none inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background:
          'linear-gradient(135deg, oklch(22% 0.08 268), oklch(14% 0.04 268))',
        border: '1px solid oklch(30% 0.1 268)',
      }}
      aria-hidden
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="oklch(75% 0.14 268)"
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    </span>
  );
}
