import { useMemo, useRef, useState } from 'preact/hooks';
import type { Concept } from '@/lib/types';
import { chipColorVar, chipLabel, formatTime } from '../utils';

interface TimelineProps {
  concepts: Concept[];
  currentT: number;
  durationSec: number;
  activeId: string | null;
  onSeek: (t: number) => void;
  /** Time windows where chunked surfacing failed — rendered as a red bar,
   *  clicking re-runs the chunk. */
  failedWindows?: Array<{ startSec: number; endSec: number }>;
  onRetryWindow?: (w: { startSec: number; endSec: number }) => void;
  /** Time windows already scanned by chunked surfacing (success or failure).
   *  Rendered as a subtle accent tint so the user sees how far the run has
   *  progressed along the video's timeline. */
  processedWindows?: Array<{ startSec: number; endSec: number }>;
  /** When true, the chunked run is still in progress — unscanned regions get
   *  a shimmer to signal more is coming. */
  inProgress?: boolean;
}

/**
 * Horizontal concept timeline. Each concept is a colored dot at its timestamp
 * position, a playhead shows "now", clicking a dot or the track seeks the video.
 */
export function Timeline({
  concepts,
  currentT,
  durationSec,
  activeId,
  onSeek,
  failedWindows,
  onRetryWindow,
  processedWindows,
  inProgress,
}: TimelineProps) {
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

  const hasFailed = (failedWindows?.length ?? 0) > 0;
  const hasProcessed = (processedWindows?.length ?? 0) > 0;
  if (!durationSec || (concepts.length === 0 && !hasFailed && !hasProcessed && !inProgress)) return null;

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

        {/* processed-windows tint — subtle accent bar per successfully-scanned
            window, so the user sees how far the chunked run has progressed. */}
        {(processedWindows ?? []).map((w) => {
          const left = Math.max(0, (w.startSec / d) * 100);
          const right = Math.min(100, (w.endSec / d) * 100);
          const width = Math.max(0.3, right - left);
          return (
            <div
              key={`proc-${w.startSec}`}
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: 'color-mix(in oklab, var(--color-accent) 18%, transparent)',
                zIndex: 0,
              }}
            />
          );
        })}

        {/* in-progress shimmer on the not-yet-scanned region, hinting more is
            coming. Shown only while a chunked run is active. */}
        {inProgress && hasProcessed && (() => {
          // Find the rightmost processed endSec, shimmer everything after.
          const lastEnd = (processedWindows ?? []).reduce(
            (m, w) => Math.max(m, w.endSec),
            0,
          );
          const left = Math.min(100, (lastEnd / d) * 100);
          const width = Math.max(0, 100 - left);
          if (width <= 0.1) return null;
          return (
            <div
              className="absolute top-0 bottom-0 pointer-events-none shimmer rounded-r-full"
              style={{ left: `${left}%`, width: `${width}%`, opacity: 0.5, zIndex: 0 }}
            />
          );
        })()}

        {/* failed-chunk windows — translucent red bars, click to retry. */}
        {(failedWindows ?? []).map((w) => {
          const left = Math.max(0, (w.startSec / d) * 100);
          const right = Math.min(100, (w.endSec / d) * 100);
          const width = Math.max(0.5, right - left);
          return (
            <button
              key={`fail-${w.startSec}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetryWindow?.(w);
              }}
              title={`Couldn't analyze ${Math.floor(w.startSec / 60)}:${String(Math.floor(w.startSec) % 60).padStart(2, '0')}–${Math.floor(w.endSec / 60)}:${String(Math.floor(w.endSec) % 60).padStart(2, '0')}. Click to retry.`}
              className="absolute top-0 bottom-0 rounded-sm cursor-pointer transition-opacity hover:opacity-100"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background:
                  'repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-danger) 55%, transparent) 0 4px, color-mix(in oklab, var(--color-danger) 30%, transparent) 4px 8px)',
                opacity: 0.85,
                zIndex: 0,
              }}
              aria-label="Retry this section"
            />
          );
        })}

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
