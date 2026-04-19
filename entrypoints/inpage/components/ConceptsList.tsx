import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Concept, EntityType } from '@/lib/types';
import { chipColorVar, chipLabel, formatTime } from '../utils';
import { TypeIcon } from './TypeIcon';

interface ConceptsListProps {
  concepts: Concept[];
  activeId: string | null;
  currentT: number;
  filter: string;
  videoId: string;
  onSeek: (t: number) => void;
  onOpenDetail: (c: Concept) => void;
  onSaveToNotes: (c: Concept) => void;
}

/** Scroll a child into view WITHIN a specific scroll container, without
 *  bubbling the scroll up to ancestors (which caused the whole-page
 *  scroll-up bug when the Gloss panel is in a Shadow DOM). */
function scrollChildTo(
  scroller: HTMLElement,
  child: HTMLElement,
  placement: 'top' | 'center' = 'top',
  offset = 12,
) {
  const childTop = child.offsetTop - scroller.offsetTop;
  const target =
    placement === 'top'
      ? childTop - offset
      : childTop - scroller.clientHeight / 2 + child.clientHeight / 2;
  scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

export function ConceptsList({
  concepts,
  activeId,
  currentT,
  filter,
  videoId,
  onSeek,
  onOpenDetail,
  onSaveToNotes,
}: ConceptsListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const userScrolling = useRef(false);
  const [activeTypes, setActiveTypes] = useState<Set<EntityType>>(new Set());

  // Type-count summary for the chip row. Only include types actually present.
  const typeCounts = useMemo(() => {
    const counts = new Map<EntityType, number>();
    for (const c of concepts) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [concepts]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = concepts;
    if (activeTypes.size > 0) list = list.filter((c) => activeTypes.has(c.type));
    if (q) {
      list = list.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          chipLabel(c.type).toLowerCase().includes(q),
      );
    }
    return list;
  }, [concepts, filter, activeTypes]);

  const toggleType = (t: EntityType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  // Auto-scroll active concept to the TOP of the internal scroller. We
  // scroll the scroller manually instead of calling scrollIntoView, which
  // can bubble up through the Shadow DOM and scroll the outer YouTube
  // page.
  useEffect(() => {
    if (!activeId || userScrolling.current) return;
    const scroller = scrollerRef.current;
    const el = activeRef.current;
    if (scroller && el) scrollChildTo(scroller, el, 'top');
  }, [activeId]);

  // Track user scrolling so auto-follow yields for ~1.5s after any manual
  // scroll. When the user stops, auto-scroll re-engages on the next
  // active-concept change.
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
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {typeCounts.length > 1 && (
        <div className="flex-none px-3 pt-1.5 pb-1 flex flex-wrap items-center gap-1">
          {typeCounts.map(([t, n]) => {
            const on = activeTypes.has(t);
            const anyOn = activeTypes.size > 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                aria-pressed={on}
                title={`${chipLabel(t)} · ${n}`}
                className="flex-none inline-flex items-center gap-1 h-[20px] px-1.5 rounded-full text-[10px] font-semibold transition-all"
                style={{
                  color: on ? chipColorVar(t) : 'var(--color-fg-muted)',
                  background: on
                    ? `color-mix(in oklab, ${chipColorVar(t)} 16%, transparent)`
                    : 'var(--color-surface)',
                  border: `1px solid ${
                    on
                      ? `color-mix(in oklab, ${chipColorVar(t)} 55%, transparent)`
                      : 'var(--color-border)'
                  }`,
                  opacity: anyOn && !on ? 0.55 : 1,
                }}
              >
                <TypeIcon type={t} size={10} />
                <span>{chipLabel(t)}</span>
                <span className="font-mono tabular-nums text-[9px] opacity-70">{n}</span>
              </button>
            );
          })}
          {activeTypes.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveTypes(new Set())}
              className="flex-none inline-flex items-center h-[20px] px-1.5 rounded-full text-[10px] font-medium text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
              title="Clear type filter"
            >
              ×&nbsp;Clear
            </button>
          )}
        </div>
      )}

      {filter && (
        <div className="flex-none px-3 pt-1.5 pb-1 text-[10.5px] text-[var(--color-fg-subtle)]">
          Showing {filtered.length} of {concepts.length} matching <span className="italic">"{filter}"</span>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-2 pt-1 pb-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-6 py-6 text-center text-[11.5px] text-[var(--color-fg-muted)]">
            {filter || activeTypes.size > 0
              ? 'No concepts match the current filter.'
              : 'No concepts surfaced for this video.'}
          </div>
        ) : (
          filtered.map((c) => {
            const isActive = c.id === activeId;
            const isPast = !isActive && c.t < currentT - 4;
            return (
              <ConceptCard
                key={c.id}
                concept={c}
                videoId={videoId}
                isActive={isActive}
                isPast={isPast}
                innerRef={isActive ? activeRef : undefined}
                onSeek={onSeek}
                onOpenDetail={onOpenDetail}
                onSaveToNotes={onSaveToNotes}
              />
            );
          })
        )}
      </div>

    </div>
  );
}

interface ConceptCardProps {
  concept: Concept;
  videoId: string;
  isActive: boolean;
  isPast: boolean;
  innerRef?: preact.RefObject<HTMLButtonElement>;
  onSeek: (t: number) => void;
  onOpenDetail: (c: Concept) => void;
  onSaveToNotes: (c: Concept) => void;
}

function ConceptCard({
  concept,
  videoId,
  isActive,
  isPast,
  innerRef,
  onSeek,
  onOpenDetail,
  onSaveToNotes,
}: ConceptCardProps) {
  const c = concept;
  const [copied, setCopied] = useState(false);
  const copyLink = async (e: MouseEvent) => {
    e.stopPropagation();
    const url = `https://youtu.be/${videoId}?t=${Math.floor(c.t)}s`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore — clipboard may be blocked */
    }
  };
  return (
    <div
      ref={innerRef as any}
      onClick={() => onSeek(c.t)}
      className="group w-full rounded-lg p-3 pb-2 relative transition-all hover:bg-[var(--color-surface-hover)] cursor-pointer"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSeek(c.t);
        }
      }}
      style={{
        background: isActive
          ? 'color-mix(in oklab, var(--color-accent) 16%, var(--color-bg))'
          : 'var(--color-surface)',
        border: `1px solid ${
          isActive
            ? 'color-mix(in oklab, var(--color-accent) 55%, transparent)'
            : 'var(--color-border)'
        }`,
        boxShadow: isActive
          ? '0 0 0 3px color-mix(in oklab, var(--color-accent) 12%, transparent)'
          : 'none',
        opacity: isPast ? 0.55 : 1,
        ...(isActive ? { paddingLeft: '12px' } : {}),
      }}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
          style={{ background: 'var(--color-accent)' }}
        />
      )}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-[0.06em]"
          style={{
            color: chipColorVar(c.type),
            background: `color-mix(in oklab, ${chipColorVar(c.type)} 14%, transparent)`,
          }}
        >
          <TypeIcon type={c.type} size={10} />
          {chipLabel(c.type)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail(c);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          title="Deeper dive"
          aria-label="Open deeper explanation"
          className="ml-auto inline-flex items-center justify-center gap-1 h-[22px] px-2 rounded-full text-[10.5px] font-semibold border transition-all"
          style={{
            color: 'var(--color-accent)',
            background: 'color-mix(in oklab, var(--color-accent) 8%, transparent)',
            borderColor: 'color-mix(in oklab, var(--color-accent) 35%, transparent)',
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
          </svg>
          Dive
        </button>
        <span className="font-mono text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
          {formatTime(c.t)}
        </span>
      </div>
      <div className="text-[13.5px] font-semibold text-[var(--color-fg)] leading-snug mb-1">
        {c.label}
      </div>
      {c.description && (
        <div className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
          {c.description}
        </div>
      )}
      <div
        className="absolute bottom-1 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      >
        <button
          type="button"
          onClick={copyLink}
          onKeyDown={(e) => e.stopPropagation()}
          title={copied ? 'Link copied!' : 'Copy link at this timestamp'}
          aria-label="Copy link at this timestamp"
          className="w-6 h-6 inline-flex items-center justify-center rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] transition-colors"
          style={copied ? { color: 'var(--color-accent)' } : undefined}
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07l-1 1" />
              <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07l1-1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSaveToNotes(c);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          title="Save to notes"
          aria-label="Save to notes"
          className="w-6 h-6 inline-flex items-center justify-center rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
