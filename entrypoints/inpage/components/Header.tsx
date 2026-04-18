import { useEffect, useRef, useState } from 'preact/hooks';

interface HeaderProps {
  domain: string | null;
  conceptCount: number;
  filter: string;
  onFilter: (s: string) => void;
  onSettings: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  canRegenerate: boolean;
}

export function Header({
  domain,
  conceptCount,
  filter,
  onFilter,
  onSettings,
  onRegenerate,
  regenerating,
  canRegenerate,
}: HeaderProps) {
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  useEffect(() => {
    if (filter) setSearching(true);
  }, [filter]);

  return (
    <header className="flex-none border-b border-[var(--color-border-subtle)]">
      {/* Row 1: brand + actions */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <div
          className="flex-none w-5 h-5 inline-flex items-center justify-center rounded-md"
          style={{
            background: 'color-mix(in oklab, var(--color-accent) 14%, transparent)',
            color: 'var(--color-accent)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-4l-3 3-3-3H7a3 3 0 0 1-3-3z" />
            <path d="M9 10.5l2 2 4-4" />
          </svg>
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
          Gloss
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {!searching ? (
            <IconButton label="Search concepts" onClick={() => setSearching(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </IconButton>
          ) : (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                type="text"
                value={filter}
                onInput={(e) => onFilter((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    onFilter('');
                    setSearching(false);
                  }
                }}
                placeholder="Search concepts…"
                className="h-7 w-36 px-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[11.5px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-accent)]"
              />
              <IconButton
                label="Clear search"
                onClick={() => {
                  onFilter('');
                  setSearching(false);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </IconButton>
            </div>
          )}
          <button
            type="button"
            onClick={onRegenerate}
            disabled={!canRegenerate || regenerating}
            title="Regenerate concepts (bypasses cache)"
            aria-label="Regenerate concepts"
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={regenerating ? { animation: 'gloss-spin 0.9s linear infinite' } : undefined}
            >
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
          <IconButton label="Settings" onClick={onSettings}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </IconButton>
        </div>
      </div>

      {/* Row 2: domain heading */}
      <div className="flex items-baseline gap-2 px-3 pt-0.5 pb-2">
        <h2 className="flex-1 min-w-0 truncate text-[14px] font-bold text-[var(--color-fg)] leading-tight">
          {domain || 'Understanding this video'}
        </h2>
        {conceptCount > 0 && (
          <span className="flex-none font-mono text-[10.5px] tabular-nums text-[var(--color-fg-subtle)]">
            {conceptCount} concepts
          </span>
        )}
      </div>
    </header>
  );
}

function IconButton({
  children,
  onClick,
  label,
}: {
  children: preact.ComponentChildren;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] transition-colors"
    >
      {children}
    </button>
  );
}
