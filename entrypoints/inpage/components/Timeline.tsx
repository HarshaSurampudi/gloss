import { useMemo, useRef, useState } from 'preact/hooks';
import type { Concept } from '@/lib/types';
import { chipColorVar, chipLabel, formatTime } from '../utils';

interface TimelineProps {
  concepts: Concept[];
  currentT: number;
  durationSec: number;
  activeId: string | null;
  onSeek: (t: number) => void;
}

/**
 * Horizontal concept timeline. Each concept is a colored dot at its timestamp
 * position, a playhead shows "now", clicking a dot or the track seeks the video.
 */
export function Timeline({ concepts, currentT, durationSec, activeId, onSeek }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ c: Concept; x: number } | null>(null);

  const d = Math.max(durationSec, currentT, 1);
  const playheadPct = Math.min(100, Math.max(0, (currentT / d) * 100));

  // Group concepts that fall very close together so we don't over-plot.
  const dots = useMemo(() => {
    return concepts.map((c) => ({
      c,
      pct: Math.min(100, Math.max(0, (c.t / d) * 100)),
    }));
  }, [concepts, d]);

  if (!durationSec || concepts.length === 0) return null;

  return (
    <div className="flex-none px-3 pt-2 pb-2">
      <div
        ref={trackRef}
        onClick={(e) => {
          const rect = trackRef.current!.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          onSeek(Math.max(0, Math.min(d, pct * d)));
        }}
        onMouseLeave={() => setHover(null)}
        className="relative h-5 rounded-full cursor-pointer"
        style={{
          background: 'var(--color-border-subtle)',
        }}
      >
        {/* played portion */}
        <div
          className="absolute left-0 top-0 bottom-0 rounded-full pointer-events-none"
          style={{
            width: `${playheadPct}%`,
            background: 'color-mix(in oklab, var(--color-accent) 20%, transparent)',
          }}
        />

        {/* concept dots — clamp the left position so dots stay fully
            inside the track at 0% / 100% instead of bleeding off-edge. */}
        {dots.map(({ c, pct }) => {
          const isActive = c.id === activeId;
          const inset = isActive ? 8 : 5; // half-width + halo room
          return (
            <button
              key={c.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(c.t);
              }}
              onMouseEnter={(e) => {
                const rect = trackRef.current!.getBoundingClientRect();
                setHover({ c, x: e.clientX - rect.left });
              }}
              onMouseLeave={() => setHover(null)}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-transform hover:scale-150"
              style={{
                left: `clamp(${inset}px, ${pct}%, calc(100% - ${inset}px))`,
                width: isActive ? '10px' : '6px',
                height: isActive ? '10px' : '6px',
                background: chipColorVar(c.type),
                boxShadow: isActive
                  ? `0 0 0 3px color-mix(in oklab, ${chipColorVar(c.type)} 25%, transparent)`
                  : 'none',
                zIndex: isActive ? 2 : 1,
              }}
              aria-label={`${chipLabel(c.type)}: ${c.label}`}
            />
          );
        })}

        {/* playhead — same edge clamp so the vertical line never
            overflows the track. */}
        <div
          className="absolute top-[-2px] bottom-[-2px] pointer-events-none"
          style={{
            left: `clamp(1px, ${playheadPct}%, calc(100% - 1px))`,
            width: '2px',
            transform: 'translateX(-1px)',
            background: 'var(--color-accent)',
            zIndex: 3,
          }}
        />
      </div>

      {hover && (
        <div
          className="pointer-events-none relative"
          style={{ height: 0 }}
        >
          <div
            className="absolute -top-1 translate-x-[-50%] -translate-y-full z-10"
            style={{ left: `${Math.max(8, Math.min(hover.x, 380))}px` }}
          >
            <div
              className="whitespace-nowrap max-w-[240px] truncate rounded-md px-2 py-1 text-[10.5px] font-medium shadow-md"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-fg)',
                border: '1px solid var(--color-border)',
              }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                style={{ background: chipColorVar(hover.c.type) }}
              />
              {hover.c.label}
              <span className="ml-1.5 font-mono text-[var(--color-fg-subtle)]">
                {formatTime(hover.c.t)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
