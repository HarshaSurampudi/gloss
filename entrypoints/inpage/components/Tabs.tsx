/**
 * Underline-style tabs. Active tab has accent underline; inactive is muted.
 * A hairline divider runs beneath the full row.
 */
export type TabKey = 'concepts' | 'notes';

interface TabsProps {
  active: TabKey;
  onChange: (k: TabKey) => void;
  conceptCount: number;
  notesCount: number;
}

export function Tabs({ active, onChange, conceptCount, notesCount }: TabsProps) {
  return (
    <div
      role="tablist"
      className="flex-none grid"
      style={{
        gridTemplateColumns: '1fr 1fr',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <Tab
        label="Concepts"
        count={conceptCount}
        on={active === 'concepts'}
        onClick={() => onChange('concepts')}
      />
      <Tab
        label="Notes"
        count={notesCount}
        on={active === 'notes'}
        onClick={() => onChange('notes')}
      />
    </div>
  );
}

function Tab({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={
        'relative inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ' +
        (on
          ? ''
          : 'hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]')
      }
      style={{
        height: 40,
        fontSize: 13.5,
        fontWeight: on ? 700 : 500,
        color: on ? 'var(--color-fg)' : 'var(--color-fg-muted)',
        background: 'transparent',
        borderBottom: on
          ? '2px solid var(--color-accent)'
          : '2px solid transparent',
      }}
    >
      <span>{label}</span>
      {count > 0 && (
        <span
          className="inline-flex items-center justify-center font-mono tabular-nums"
          style={{
            minWidth: 20,
            height: 18,
            padding: '0 5px',
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 700,
            background: on ? 'var(--color-accent)' : 'var(--color-border)',
            color: on ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
