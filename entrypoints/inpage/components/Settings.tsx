import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Preferences } from '@/lib/types';
import { clearCache } from '@/lib/cache';
import { GEMINI_MODELS, LANGUAGES } from '@/lib/languages';

interface SettingsProps {
  prefs: Preferences;
  onClose: () => void;
  onChange: (patch: Partial<Preferences>) => void;
}

const DIFFS: Preferences['difficulty'][] = ['auto', 'beginner', 'intermediate', 'expert'];

export function Settings({ prefs, onClose, onChange }: SettingsProps) {
  const [apiKeyEditing, setApiKeyEditing] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [cleared, setCleared] = useState(false);
  const clearTimer = useRef<number | undefined>(undefined);

  // Two-click cache-clear: first click arms the button (label flips, goes
  // red). A second click within 3s actually clears; otherwise it reverts.
  useEffect(() => {
    if (!clearArmed) return;
    clearTimer.current = window.setTimeout(() => setClearArmed(false), 3000);
    return () => window.clearTimeout(clearTimer.current);
  }, [clearArmed]);

  const handleClearClick = async () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    window.clearTimeout(clearTimer.current);
    setClearArmed(false);
    await clearCache();
    setCleared(true);
    setTimeout(() => setCleared(false), 1800);
  };

  const hasApiKey = !!prefs.geminiApiKey;
  const showApiKeyEditor = !hasApiKey || apiKeyEditing;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col"
      style={{ background: 'var(--color-bg)' }}
    >
      {/* Top bar: SETTINGS eyebrow + Done */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <div
          className="font-semibold uppercase text-[var(--color-fg-subtle)]"
          style={{ fontSize: 10.5, letterSpacing: '0.18em' }}
        >
          Settings
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center transition-opacity hover:opacity-90"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            fontSize: 12.5,
            fontWeight: 600,
            height: 28,
            padding: '0 14px',
            borderRadius: 8,
          }}
        >
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Section: How Gloss reads to you */}
        <Section title="How Gloss reads to you">
          <Field label="Explain in">
            <SearchableDropdown
              value={prefs.explainInLang}
              onChange={(v) => onChange({ explainInLang: v })}
              options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
            />
            <Helper>Language independent of the video audio.</Helper>
          </Field>

          <Field label="Difficulty">
            <Segmented
              value={prefs.difficulty}
              onChange={(v) => onChange({ difficulty: v as Preferences['difficulty'] })}
              options={DIFFS.map((d) => ({ value: d, label: capitalize(d) }))}
            />
          </Field>

          <Field label="Additional context (optional)">
            <ContextPresets
              current={prefs.additionalContext ?? ''}
              onPick={(text) => onChange({ additionalContext: text })}
            />
            <textarea
              value={prefs.additionalContext ?? ''}
              onInput={(e) =>
                onChange({ additionalContext: (e.target as HTMLTextAreaElement).value })
              }
              rows={3}
              placeholder='e.g. "I&apos;m a software engineer new to Kubernetes." Or "Skip basics I already know."'
              className="w-full resize-y outline-none"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-fg)',
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: 'inherit',
                minHeight: 88,
              }}
            />
            <Helper>
              Included with every request so Gloss can angle explanations for your background. Plain text, a line or two.
            </Helper>
          </Field>
        </Section>

        <Divider />

        {/* Section: Model & generation */}
        <Section title="Model & generation">
          <Field label="Model">
            <Dropdown
              value={prefs.geminiModel}
              onChange={(v) => onChange({ geminiModel: v })}
              options={GEMINI_MODELS.map((m) => ({
                value: m.id,
                label: `${m.name.toLowerCase()} — ${m.hint.toLowerCase()}`,
              }))}
            />
          </Field>

          <Field label="Auto-generate">
            <div className="flex items-center gap-2.5">
              <Toggle
                on={prefs.autoGenerate}
                onClick={() => onChange({ autoGenerate: !prefs.autoGenerate })}
              />
              <span className="text-[var(--color-fg)]" style={{ fontSize: 13 }}>
                {prefs.autoGenerate ? 'On — runs automatically' : 'Off — click to generate'}
              </span>
            </div>
            <Helper>
              When off, Gloss only runs when you click Generate. Cached videos still load instantly.
            </Helper>
          </Field>

          <Field label="Summary & key moments">
            <div className="flex items-center gap-2.5">
              <Toggle
                on={prefs.keyMomentsEnabled}
                onClick={() =>
                  onChange({ keyMomentsEnabled: !prefs.keyMomentsEnabled })
                }
              />
              <span className="text-[var(--color-fg)]" style={{ fontSize: 13 }}>
                {prefs.keyMomentsEnabled ? 'On' : 'Off'}
              </span>
            </div>
            <Helper>
              When on, Gloss runs one extra call per video to produce a short summary and 4–8 key moments you can jump to. Off by default — adds one extra Gemini call.
            </Helper>
          </Field>

          <Field label="API key">
            {showApiKeyEditor ? (
              <input
                type="password"
                value={prefs.geminiApiKey ?? ''}
                onInput={(e) =>
                  onChange({ geminiApiKey: (e.target as HTMLInputElement).value })
                }
                onBlur={() => {
                  if (hasApiKey) setApiKeyEditing(false);
                }}
                placeholder="AIza…"
                autoFocus={apiKeyEditing}
                className="w-full outline-none focus:border-[var(--color-accent)]"
                style={{
                  height: 38,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-fg)',
                  fontSize: 13,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                }}
              />
            ) : (
              <div
                className="flex items-center justify-between"
                style={{
                  height: 38,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span
                  className="text-[var(--color-fg-muted)] tracking-[0.25em]"
                  style={{ fontSize: 14, userSelect: 'none' }}
                >
                  {'•'.repeat(24)}
                </span>
                <button
                  type="button"
                  onClick={() => setApiKeyEditing(true)}
                  className="transition-opacity hover:opacity-80"
                  style={{
                    color: 'var(--color-accent)',
                    fontSize: 12.5,
                    fontWeight: 500,
                  }}
                >
                  Replace
                </button>
              </div>
            )}
          </Field>
        </Section>

        <Divider />

        {/* Section: Cache */}
        <Section title="Cache">
          <Helper>
            Transcripts and concepts are cached per video so re-opens are instant.
          </Helper>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearClick}
              className="inline-flex items-center transition-colors"
              style={{
                background: clearArmed
                  ? 'color-mix(in oklab, var(--color-danger) 14%, transparent)'
                  : 'var(--color-surface)',
                border: `1px solid ${
                  clearArmed
                    ? 'color-mix(in oklab, var(--color-danger) 60%, transparent)'
                    : 'var(--color-border)'
                }`,
                color: clearArmed ? 'var(--color-danger)' : 'var(--color-fg)',
                fontSize: 12.5,
                fontWeight: 500,
                height: 32,
                padding: '0 14px',
                borderRadius: 8,
              }}
            >
              {clearArmed ? 'Click again to confirm' : 'Clear cached videos'}
            </button>
            {cleared && (
              <span
                className="text-[var(--color-accent)]"
                style={{ fontSize: 12, fontWeight: 500 }}
              >
                Cleared ✓
              </span>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Context presets (quick-add chips for additional context) ──────────

const CONTEXT_PRESETS: Array<{ label: string; text: string }> = [
  {
    label: 'Logical fallacies only',
    text:
      'OVERRIDE: ignore the default concept-surfacing behavior. For this video, surface ONLY logical fallacies, rhetorical sleights, and reasoning flaws actually used by the speakers. Each entry: name the fallacy, quote or paraphrase the exact moment it occurs, and explain briefly why it qualifies. Do not surface regular concepts, people, places, tools, or jargon.',
  },
  {
    label: 'Skip basics',
    text: 'Skip the basics — go straight to the non-obvious.',
  },
  {
    label: 'Study notes',
    text: 'Optimize for study notes: concise, structured, retention-friendly.',
  },
];

/**
 * Single-select preset chips that replace the current additional-context
 * text. Clicking an active preset clears it. A preset reads as "active"
 * only when the textarea contains exactly its snippet (so hand-edits
 * automatically deselect whichever chip was on).
 */
function ContextPresets({
  current,
  onPick,
}: {
  current: string;
  onPick: (text: string) => void;
}) {
  const activeText = current.trim();
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {CONTEXT_PRESETS.map((p) => {
        const active = activeText === p.text.trim();
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(active ? '' : p.text)}
            title={active ? 'Click to clear' : p.text}
            aria-pressed={active}
            className="inline-flex items-center gap-1 transition-colors"
            style={{
              height: 22,
              padding: '0 9px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
              color: active ? 'var(--color-accent)' : 'var(--color-fg-muted)',
              background: active
                ? 'color-mix(in oklab, var(--color-accent) 14%, transparent)'
                : 'var(--color-surface)',
              border: `1px solid ${
                active
                  ? 'color-mix(in oklab, var(--color-accent) 40%, transparent)'
                  : 'var(--color-border)'
              }`,
            }}
          >
            {active && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Section primitives ─────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div className="px-4 pt-5 pb-4">
      <h2
        className="text-[var(--color-fg)]"
        style={{
          fontFamily: '"Source Serif 4", Georgia, serif',
          fontSize: 19,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          marginBottom: 14,
        }}
      >
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: preact.ComponentChildren;
}) {
  return (
    <label className="block">
      <span
        className="block font-semibold uppercase text-[var(--color-fg-subtle)]"
        style={{ fontSize: 10.5, letterSpacing: '0.14em', marginBottom: 8 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Helper({ children }: { children: preact.ComponentChildren }) {
  return (
    <div
      className="text-[var(--color-fg-muted)]"
      style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 8 }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div className="mx-4 border-t border-[var(--color-border-subtle)]" />
  );
}

// ─── Form controls ──────────────────────────────────────────────────────

function Dropdown<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}
        className="w-full appearance-none outline-none focus:border-[var(--color-accent)] cursor-pointer"
        style={{
          height: 38,
          padding: '0 32px 0 12px',
          borderRadius: 8,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-fg)',
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      >
        {options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        className="pointer-events-none absolute top-1/2 -translate-y-1/2"
        style={{ right: 12, color: 'var(--color-fg-muted)' }}
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

/**
 * Dropdown with a search input — opens a popover with a filter box and a
 * scrollable list of matching options. Needed for the language picker
 * because scrolling through ~100 options to find a specific one is
 * miserable otherwise.
 */
function SearchableDropdown<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        o.value.toLowerCase().includes(needle),
    );
  }, [options, q]);

  // Clamp highlight when the filter changes.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus the search input + reset query/highlight when opening.
  useEffect(() => {
    if (!open) return;
    setQ('');
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, value, options]);

  // Keep the highlighted row in view while arrow-keying.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    if (!row) return;
    const rTop = row.offsetTop;
    const rBottom = rTop + row.offsetHeight;
    if (rTop < list.scrollTop) list.scrollTop = rTop;
    else if (rBottom > list.scrollTop + list.clientHeight)
      list.scrollTop = rBottom - list.clientHeight;
  }, [highlight]);

  const choose = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center outline-none focus:border-[var(--color-accent)] transition-colors"
        style={{
          height: 38,
          padding: '0 32px 0 12px',
          borderRadius: 8,
          background: 'var(--color-surface)',
          border: `1px solid ${open ? 'var(--color-accent)' : 'var(--color-border)'}`,
          color: 'var(--color-fg)',
          fontSize: 13,
          textAlign: 'left',
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <span className="flex-1 truncate">{current?.label ?? value}</span>
        <svg
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2"
          style={{ right: 12, color: 'var(--color-fg-muted)' }}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-30"
          style={{
            top: 'calc(100% + 4px)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            boxShadow:
              '0 12px 32px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden',
          }}
          role="listbox"
        >
          <div
            className="flex items-center"
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg)',
            }}
          >
            <svg
              aria-hidden
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--color-fg-subtle)', marginRight: 6 }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              value={q}
              onInput={(e) => {
                setQ((e.target as HTMLInputElement).value);
                setHighlight(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const pick = filtered[highlight];
                  if (pick) choose(pick.value);
                }
              }}
              placeholder="Search…"
              className="flex-1 bg-transparent outline-none"
              style={{
                color: 'var(--color-fg)',
                fontSize: 12.5,
              }}
            />
          </div>
          <div
            ref={listRef}
            style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}
          >
            {filtered.length === 0 ? (
              <div
                className="text-[var(--color-fg-muted)]"
                style={{ padding: '14px 12px', fontSize: 12 }}
              >
                No matches.
              </div>
            ) : (
              filtered.map((o, i) => {
                const selected = o.value === value;
                const active = i === highlight;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-idx={i}
                    onClick={() => choose(o.value)}
                    onMouseEnter={() => setHighlight(i)}
                    className="w-full text-left flex items-center gap-2"
                    style={{
                      padding: '7px 12px',
                      fontSize: 13,
                      background: active
                        ? 'color-mix(in oklab, var(--color-accent) 16%, transparent)'
                        : 'transparent',
                      color: selected
                        ? 'var(--color-accent)'
                        : 'var(--color-fg)',
                    }}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {selected && (
                      <svg
                        aria-hidden
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div
      role="radiogroup"
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        borderRadius: 10,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        const isFirst = i === 0;
        const isLast = i === options.length - 1;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className="inline-flex items-center justify-center transition-colors"
            style={{
              height: 34,
              fontSize: 12.5,
              fontWeight: 600,
              background: on ? 'var(--color-accent)' : 'transparent',
              color: on ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
              borderTopLeftRadius: isFirst ? 9 : 0,
              borderBottomLeftRadius: isFirst ? 9 : 0,
              borderTopRightRadius: isLast ? 9 : 0,
              borderBottomRightRadius: isLast ? 9 : 0,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex-none relative rounded-full transition-colors outline-none"
      style={{
        width: 40,
        height: 22,
        padding: 0,
        border: 'none',
        background: on ? 'var(--color-accent)' : 'var(--color-border)',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: 9999,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transition: 'left 180ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        }}
      />
    </button>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
