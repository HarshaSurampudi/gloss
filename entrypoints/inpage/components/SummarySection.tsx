import type { KeyMoment } from '@/lib/gemini';
import { formatTime } from '../utils';

interface Props {
  summary: string;
  keyMoments: KeyMoment[];
  loading?: boolean;
  error?: string | null;
  onSeek: (t: number) => void;
}

/**
 * Panel block that replaces YouTube's video description with a Gloss-
 * generated summary and a clickable list of key moments. Rendered only
 * when the `keyMomentsEnabled` preference is on.
 */
export function SummarySection({
  summary,
  keyMoments,
  loading,
  error,
  onSeek,
}: Props) {
  const empty = !loading && !error && !summary && keyMoments.length === 0;
  if (empty) return null;

  return (
    <div className="flex-none border-b border-[var(--color-border-subtle)] px-4 pt-3 pb-3">
      {loading && (
        <div className="space-y-2">
          <div className="h-3 w-20 rounded shimmer" />
          <div className="h-3 w-11/12 rounded shimmer" />
          <div className="h-3 w-9/12 rounded shimmer" />
          <div className="mt-2 h-3 w-24 rounded shimmer" />
          {[80, 64, 72].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded shimmer"
              style={{ width: w + '%' }}
            />
          ))}
        </div>
      )}

      {error && (
        <div
          className="text-[var(--color-danger)]"
          style={{ fontSize: 12, lineHeight: 1.5 }}
        >
          Couldn't generate summary: {error}
        </div>
      )}

      {!loading && !error && summary && (
        <div>
          <Eyebrow>Summary</Eyebrow>
          <p
            className="text-[var(--color-fg)]"
            style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6 }}
          >
            {summary}
          </p>
        </div>
      )}

      {!loading && !error && keyMoments.length > 0 && (
        <div style={{ marginTop: summary ? 16 : 0 }}>
          <Eyebrow>Key moments</Eyebrow>
          <div className="mt-2 space-y-1">
            {keyMoments.map((m, i) => (
              <button
                key={`${i}-${m.startSec}`}
                type="button"
                onClick={() => onSeek(m.startSec)}
                className="w-full text-left flex gap-2.5 transition-colors"
                style={{
                  padding: '7px 9px',
                  borderRadius: 8,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <span
                  className="flex-none font-mono tabular-nums"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--color-accent)',
                    marginTop: 1,
                    minWidth: 44,
                  }}
                >
                  {formatTime(m.startSec)}
                </span>
                <span className="flex-1 min-w-0">
                  <div
                    className="text-[var(--color-fg)] truncate"
                    style={{ fontSize: 12.5, fontWeight: 600 }}
                  >
                    {m.label}
                  </div>
                  {m.description && (
                    <div
                      className="text-[var(--color-fg-muted)]"
                      style={{
                        fontSize: 11.5,
                        lineHeight: 1.45,
                        marginTop: 2,
                      }}
                    >
                      {m.description}
                    </div>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Eyebrow({ children }: { children: preact.ComponentChildren }) {
  return (
    <div
      className="text-[var(--color-fg-subtle)] font-semibold uppercase"
      style={{ fontSize: 10.5, letterSpacing: '0.14em' }}
    >
      {children}
    </div>
  );
}
