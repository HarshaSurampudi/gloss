import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TranscriptSegment } from '@/lib/types';
import { formatTime } from '../utils';

interface CaptionStripProps {
  segments: TranscriptSegment[];
  currentT: number;
  onSeek: (t: number) => void;
  sourceLang?: string;
  targetLang?: string;
  translatedTexts?: string[] | null;
  translating?: boolean;
  onAddNote?: (t: number, text: string, segmentText?: string) => void;
}

type View = 'source' | 'target';

/**
 * Teleprompter-style caption view. Default: three lines (prev · current · next)
 * with the current line as the visual anchor — larger, bolder, centered.
 * Click to expand into a full scrollable transcript with search.
 *
 * When translation is enabled and available, a tight segmented toggle in the
 * header lets the user flip between the source and the target language.
 */
export function CaptionStrip(props: CaptionStripProps) {
  const [expanded, setExpanded] = useState(false);
  const translationAvailable =
    !!props.translatedTexts && props.translatedTexts.length === props.segments.length;
  const langsDiffer =
    !!props.sourceLang &&
    !!props.targetLang &&
    props.sourceLang.split('-')[0] !== props.targetLang.split('-')[0];

  // Default to target when translation has arrived (user opted in).
  const [view, setView] = useState<View>('source');
  useEffect(() => {
    if (translationAvailable) setView('target');
  }, [translationAvailable]);

  const effectiveTexts: string[] = useMemo(() => {
    if (view === 'target' && translationAvailable && props.translatedTexts) {
      return props.translatedTexts;
    }
    return props.segments.map((s) => s.text);
  }, [view, translationAvailable, props.translatedTexts, props.segments]);

  const langToggle = (props.translating || translationAvailable) && langsDiffer ? (
    <LangToggle
      view={view}
      onChange={setView}
      source={props.sourceLang ?? 'src'}
      target={props.targetLang ?? 'tgt'}
      translating={!!props.translating && !translationAvailable}
      disabled={!translationAvailable}
    />
  ) : null;

  return expanded ? (
    <FullTranscript
      segments={props.segments}
      texts={effectiveTexts}
      currentT={props.currentT}
      onSeek={props.onSeek}
      onClose={() => setExpanded(false)}
      langToggle={langToggle}
      onAddNote={props.onAddNote}
    />
  ) : (
    <Compact
      segments={props.segments}
      texts={effectiveTexts}
      currentT={props.currentT}
      onSeek={props.onSeek}
      onExpand={() => setExpanded(true)}
      langToggle={langToggle}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────

interface LangToggleProps {
  view: View;
  onChange: (v: View) => void;
  source: string;
  target: string;
  translating: boolean;
  disabled: boolean;
}

function LangToggle({ view, onChange, source, target, translating, disabled }: LangToggleProps) {
  const srcCode = source.split('-')[0].toUpperCase();
  const tgtCode = target.split('-')[0].toUpperCase();
  return (
    <div
      role="tablist"
      aria-label="Caption language"
      className="flex-none inline-flex items-center h-[20px] rounded-full p-[2px] text-[9.5px] font-semibold tracking-wider"
      style={{
        background: 'color-mix(in oklab, var(--color-fg-subtle) 20%, transparent)',
        border: '1px solid color-mix(in oklab, var(--color-fg-subtle) 18%, transparent)',
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === 'source'}
        onClick={() => onChange('source')}
        className="inline-flex items-center h-[16px] px-1.5 rounded-full transition-colors"
        style={{
          background: view === 'source' ? 'var(--color-bg)' : 'transparent',
          color: view === 'source' ? 'var(--color-fg)' : 'var(--color-fg-subtle)',
          boxShadow:
            view === 'source'
              ? '0 1px 2px color-mix(in oklab, var(--color-fg) 20%, transparent)'
              : 'none',
        }}
      >
        {srcCode}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'target'}
        onClick={() => !disabled && onChange('target')}
        disabled={disabled}
        className="inline-flex items-center h-[16px] px-1.5 rounded-full transition-colors"
        style={{
          background: view === 'target' ? 'var(--color-accent)' : 'transparent',
          color:
            view === 'target'
              ? 'var(--color-accent-fg)'
              : disabled
              ? 'var(--color-fg-subtle)'
              : 'var(--color-fg-muted)',
          opacity: disabled && !translating ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
          boxShadow:
            view === 'target'
              ? '0 1px 2px color-mix(in oklab, var(--color-accent) 40%, transparent)'
              : 'none',
        }}
      >
        {translating ? (
          <span
            className="inline-block w-[8px] h-[8px] rounded-full"
            style={{
              border: '1.5px solid currentColor',
              borderRightColor: 'transparent',
              animation: 'gloss-spin 0.7s linear infinite',
            }}
          />
        ) : (
          tgtCode
        )}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

interface CompactProps {
  segments: TranscriptSegment[];
  texts: string[];
  currentT: number;
  onSeek: (t: number) => void;
  onExpand: () => void;
  langToggle: preact.ComponentChild;
}

function Compact({ segments, texts, currentT, onSeek, onExpand, langToggle }: CompactProps) {
  const idx = useMemo(() => findActiveIdx(segments, currentT), [segments, currentT]);
  const prev = idx > 0 ? { seg: segments[idx - 1], text: texts[idx - 1] } : null;
  const current = idx >= 0 ? { seg: segments[idx], text: texts[idx] } : null;
  const next =
    idx >= 0 && idx < segments.length - 1
      ? { seg: segments[idx + 1], text: texts[idx + 1] }
      : null;

  return (
    <div
      className="flex-none relative border-b border-[var(--color-border-subtle)]"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in oklab, var(--color-accent-soft) 30%, var(--color-bg)) 0%, var(--color-bg) 100%)',
      }}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <span
          className="w-1.5 h-1.5 rounded-full anim-breathe"
          style={{ background: 'var(--color-accent)' }}
        />
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)] font-semibold">
          Transcript
        </span>
        <span className="font-mono text-[10px] text-[var(--color-fg-subtle)] tabular-nums">
          · {formatTime(currentT)}
        </span>
        <div className="ml-auto">{langToggle}</div>
      </div>

      <div className="px-4 pb-2.5 pt-0.5">
        <Line
          text={prev?.text}
          onClick={prev ? () => onSeek(prev.seg.start) : undefined}
          variant="faint"
        />
        <div
          key={current?.seg.start ?? -1}
          className="py-1 anim-caption-in"
          style={{ lineHeight: 1.35 }}
        >
          {current?.text ? (
            <span className="text-[14px] font-semibold text-[var(--color-fg)]">
              {current.text}
            </span>
          ) : (
            <span className="text-[13px] italic text-[var(--color-fg-subtle)]">
              Waiting for the speaker…
            </span>
          )}
        </div>
        <Line
          text={next?.text}
          onClick={next ? () => onSeek(next.seg.start) : undefined}
          variant="faint"
        />
      </div>

      <button
        type="button"
        onClick={onExpand}
        title="Open full transcript"
        aria-label="Open full transcript"
        className="absolute bottom-1.5 right-2 inline-flex items-center gap-1 h-5 px-1.5 rounded text-[9.5px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        Full
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 14v6h6M20 10V4h-6M14 4l6 6M4 20l6-6" />
        </svg>
      </button>
    </div>
  );
}

function Line({
  text,
  variant,
  onClick,
}: {
  text?: string;
  variant: 'faint';
  onClick?: () => void;
}) {
  if (!text) return <div className="h-[14px]" />;
  const cls =
    variant === 'faint'
      ? 'text-[11.5px] text-[var(--color-fg-subtle)] leading-snug truncate'
      : '';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left ${cls} hover:text-[var(--color-fg-muted)] transition-colors`}
    >
      {text}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────

interface FullTranscriptProps {
  segments: TranscriptSegment[];
  texts: string[];
  currentT: number;
  onSeek: (t: number) => void;
  onClose: () => void;
  langToggle: preact.ComponentChild;
  onAddNote?: (t: number, text: string, segmentText?: string) => void;
}

function FullTranscript({
  segments,
  texts,
  currentT,
  onSeek,
  onClose,
  langToggle,
  onAddNote,
}: FullTranscriptProps) {
  const [notingIdx, setNotingIdx] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (notingIdx !== null) noteInputRef.current?.focus();
  }, [notingIdx]);
  const [query, setQuery] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const userScrolling = useRef(false);

  const activeIdx = useMemo(() => findActiveIdx(segments, currentT), [segments, currentT]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments.map((s, i) => ({ s, i }));
    return segments
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => texts[i].toLowerCase().includes(q));
  }, [segments, texts, query]);

  useEffect(() => {
    if (query || userScrolling.current) return;
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx, query]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let timeout: number | undefined;
    const onScroll = () => {
      userScrolling.current = true;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        userScrolling.current = false;
      }, 1500);
    };
    el.addEventListener('wheel', onScroll, { passive: true });
    el.addEventListener('touchstart', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onScroll);
      el.removeEventListener('touchstart', onScroll);
    };
  }, []);

  return (
    <div
      className="flex-none flex flex-col border-b border-[var(--color-border-subtle)]"
      style={{
        background: 'color-mix(in oklab, var(--color-accent-soft) 10%, var(--color-bg))',
        maxHeight: '55%',
      }}
    >
      <div className="flex-none flex items-center gap-2 px-3 pt-2 pb-1">
        <span
          className="w-1.5 h-1.5 rounded-full anim-breathe"
          style={{ background: 'var(--color-accent)' }}
        />
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)] font-semibold">
          Full Transcript
        </span>
        <span className="text-[10px] text-[var(--color-fg-subtle)]">· {formatTime(currentT)}</span>
        <div className="ml-auto flex items-center gap-1">
          {langToggle}
          <input
            type="text"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder="Find…"
            className="h-6 w-24 px-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-accent)]"
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), onClose())}
          />
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
            title="Collapse"
            aria-label="Collapse"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="overflow-y-auto px-2 pb-2" style={{ maxHeight: '280px' }}>
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11.5px] text-[var(--color-fg-muted)]">
            No matches for <span className="italic">"{query}"</span>
          </div>
        ) : (
          filtered.map(({ s, i }) => {
            const isActive = i === activeIdx;
            const isNoting = notingIdx === i;
            return (
              <div key={i} className="group">
                <div
                  ref={isActive && !query ? (activeRef as any) : undefined}
                  onClick={() => onSeek(s.start)}
                  className="w-full text-left flex gap-2 px-2 py-1.5 rounded items-start transition-colors hover:bg-[var(--color-surface-hover)] cursor-pointer"
                  style={isActive ? { background: 'color-mix(in oklab, var(--color-accent) 16%, transparent)' } : undefined}
                >
                  <span
                    className="flex-none font-mono text-[10.5px] tabular-nums pt-[2px]"
                    style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-fg-subtle)' }}
                  >
                    {formatTime(s.start)}
                  </span>
                  <span
                    className="flex-1 text-[12px] leading-snug"
                    style={{
                      color: isActive ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                      fontWeight: isActive ? 500 : 400,
                    }}
                  >
                    {query ? highlight(texts[i], query) : texts[i]}
                  </span>
                  {onAddNote && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNotingIdx(i);
                        setNoteDraft('');
                      }}
                      title="Save as note"
                      aria-label="Save as note"
                      className="flex-none w-5 h-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] transition-opacity"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                      </svg>
                    </button>
                  )}
                </div>
                {isNoting && onAddNote && (
                  <div
                    className="mx-2 my-1 p-2 rounded-md"
                    style={{ background: 'color-mix(in oklab, var(--color-accent) 10%, var(--color-bg))', border: '1px solid color-mix(in oklab, var(--color-accent) 30%, transparent)' }}
                  >
                    <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--color-fg-subtle)] mb-1">
                      Note at {formatTime(s.start)}
                    </div>
                    <textarea
                      ref={noteInputRef}
                      rows={2}
                      value={noteDraft}
                      placeholder="Optional thought… or leave blank to bookmark."
                      onInput={(e) => setNoteDraft((e.target as HTMLTextAreaElement).value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setNotingIdx(null);
                        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          onAddNote(s.start, noteDraft.trim(), texts[i]);
                          setNotingIdx(null);
                        }
                      }}
                      className="w-full px-2 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-[12px] leading-snug resize-none outline-none focus:border-[var(--color-accent)]"
                    />
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onAddNote(s.start, noteDraft.trim(), texts[i]);
                          setNotingIdx(null);
                        }}
                        className="h-7 px-2.5 rounded-md text-[11px] font-semibold bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotingIdx(null)}
                        className="h-7 px-2 rounded-md text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                      >
                        Cancel
                      </button>
                      <div className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">⌘↵</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const lower = text.toLowerCase();
  const pattern = q.toLowerCase();
  const parts: preact.ComponentChild[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(pattern, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark
        key={idx}
        style={{
          background: 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          color: 'var(--color-fg)',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {text.slice(idx, idx + pattern.length)}
      </mark>,
    );
    i = idx + pattern.length;
  }
  return parts;
}

function findActiveIdx(segments: TranscriptSegment[], t: number): number {
  if (!segments.length) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
