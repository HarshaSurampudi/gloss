import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Concept } from '@/lib/types';
import { chipColorVar, chipLabel, formatTime } from '../utils';
import { TypeIcon } from './TypeIcon';

interface ConceptsListProps {
  concepts: Concept[];
  activeId: string | null;
  currentT: number;
  filter: string;
  onSeek: (t: number) => void;
  onOpenDetail: (c: Concept) => void;
}

export function ConceptsList({
  concepts,
  activeId,
  currentT,
  filter,
  onSeek,
  onOpenDetail,
}: ConceptsListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const userScrolling = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return concepts;
    return concepts.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        chipLabel(c.type).toLowerCase().includes(q),
    );
  }, [concepts, filter]);

  // Auto-scroll to active concept, yielding to user.
  useEffect(() => {
    if (!activeId || userScrolling.current) return;
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeId]);

  // Track scrolling to yield auto-follow + decide whether to show Jump-to-now.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let timeout: number | undefined;
    const checkJump = () => {
      const active = activeRef.current;
      if (!active) {
        setShowJump(false);
        return;
      }
      const a = active.getBoundingClientRect();
      const s = el.getBoundingClientRect();
      const outOfView = a.bottom < s.top || a.top > s.bottom;
      setShowJump(outOfView);
    };
    const onScroll = () => {
      userScrolling.current = true;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        userScrolling.current = false;
      }, 1500);
      checkJump();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    checkJump();
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeId, filtered.length]);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {filter && (
        <div className="flex-none px-3 pt-1.5 pb-1 text-[10.5px] text-[var(--color-fg-subtle)]">
          Showing {filtered.length} of {concepts.length} matching <span className="italic">"{filter}"</span>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-2 pt-1 pb-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-6 py-6 text-center text-[11.5px] text-[var(--color-fg-muted)]">
            {filter ? `No matches for "${filter}"` : 'No concepts surfaced for this video.'}
          </div>
        ) : (
          filtered.map((c) => {
            const isActive = c.id === activeId;
            const isPast = !isActive && c.t < currentT - 4;
            return (
              <ConceptCard
                key={c.id}
                concept={c}
                isActive={isActive}
                isPast={isPast}
                innerRef={isActive ? activeRef : undefined}
                onSeek={onSeek}
                onOpenDetail={onOpenDetail}
              />
            );
          })
        )}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => {
            userScrolling.current = false;
            activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }}
          className="absolute left-1/2 -translate-x-1/2 bottom-2 inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-medium shadow-lg"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
          Jump to now
        </button>
      )}
    </div>
  );
}

interface ConceptCardProps {
  concept: Concept;
  isActive: boolean;
  isPast: boolean;
  innerRef?: preact.RefObject<HTMLButtonElement>;
  onSeek: (t: number) => void;
  onOpenDetail: (c: Concept) => void;
}

function ConceptCard({ concept, isActive, isPast, innerRef, onSeek, onOpenDetail }: ConceptCardProps) {
  const c = concept;
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
    </div>
  );
}
