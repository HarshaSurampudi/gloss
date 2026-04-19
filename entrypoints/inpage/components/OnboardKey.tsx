import { useState } from 'preact/hooks';
import type { Preferences } from '@/lib/types';
import { GlossLogo } from './GlossLogo';

interface OnboardKeyProps {
  onSave: (patch: { geminiApiKey: string; difficulty: Preferences['difficulty'] }) => void | Promise<void>;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok' }
  | { status: 'bad'; message: string };

const DIFFS: Preferences['difficulty'][] = ['auto', 'beginner', 'intermediate', 'expert'];

export function OnboardKey({ onSave }: OnboardKeyProps) {
  const [key, setKey] = useState('');
  const [difficulty, setDifficulty] = useState<Preferences['difficulty']>('auto');
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  const trimmedKey = key.trim();
  const canSubmit = !!trimmedKey && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    await onSave({ geminiApiKey: trimmedKey, difficulty });
  };

  const runTest = async () => {
    if (!trimmedKey || test.status === 'testing') return;
    setTest({ status: 'testing' });
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`,
      );
      if (res.ok) {
        setTest({ status: 'ok' });
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = (body as any)?.error?.message || `HTTP ${res.status}`;
        setTest({ status: 'bad', message: msg });
      }
    } catch (e: any) {
      setTest({ status: 'bad', message: String(e?.message ?? e) });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-5 pt-5 pb-8">
        {/* Header: logo + wordmark on left, SETUP chip on right */}
        <div className="flex items-center">
          <GlossLogo size={32} />
          <span
            className="font-semibold uppercase text-[var(--color-fg-subtle)]"
            style={{ fontSize: 13, letterSpacing: '0.22em', marginLeft: 10 }}
          >
            Gloss
          </span>
          <span
            className="ml-auto uppercase"
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              color: 'var(--color-fg-muted)',
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              fontWeight: 600,
            }}
          >
            Setup 1 / 1
          </span>
        </div>

        {/* Hero */}
        <h1
          className="text-[var(--color-fg)]"
          style={{
            fontFamily: '"Source Serif 4", Georgia, serif',
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            lineHeight: 1.15,
            marginTop: 28,
          }}
        >
          Connect Gemini to start glossing.
        </h1>
        <p
          className="text-[var(--color-fg-muted)]"
          style={{ fontSize: 13, lineHeight: 1.55, marginTop: 10 }}
        >
          Your key stays on this device — Gloss never proxies your requests through a server. Free tier works great for most videos.
        </p>

        {/* Step 1 */}
        <Step num={1} title="Grab a free key">
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-1 transition-opacity hover:opacity-80"
            style={{
              color: 'var(--color-accent)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Open Google AI Studio
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 17L17 7M10 7h7v7" />
            </svg>
          </a>
        </Step>

        {/* Step 2 — highlighted card */}
        <Step num={2} title="Paste it here" emphasized>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="password"
              value={key}
              onInput={(e) => {
                setKey((e.target as HTMLInputElement).value);
                if (test.status !== 'idle') setTest({ status: 'idle' });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="AIzaSy…"
              autoFocus
              className="flex-1 outline-none focus:border-[var(--color-accent)]"
              style={{
                height: 38,
                padding: '0 12px',
                borderRadius: 8,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-fg)',
                fontSize: 13,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              }}
            />
            <button
              type="button"
              onClick={runTest}
              disabled={!trimmedKey || test.status === 'testing'}
              className="inline-flex items-center transition-colors disabled:opacity-40"
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 8,
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-fg)',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: trimmedKey ? 'pointer' : 'default',
              }}
            >
              {test.status === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </div>
          {test.status === 'ok' && (
            <div
              className="mt-1.5 inline-flex items-center gap-1 text-[var(--color-accent)]"
              style={{ fontSize: 11.5, fontWeight: 500 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Key works.
            </div>
          )}
          {test.status === 'bad' && (
            <div
              className="mt-1.5 text-[var(--color-danger)]"
              style={{ fontSize: 11.5, lineHeight: 1.5 }}
            >
              Key didn't work: {test.message}
            </div>
          )}
        </Step>

        {/* Step 3 — optional difficulty */}
        <Step num={3} title="Pick a difficulty (optional)">
          <div
            className="mt-2 grid"
            style={{
              gridTemplateColumns: `repeat(${DIFFS.length}, minmax(0, 1fr))`,
              borderRadius: 10,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              overflow: 'hidden',
            }}
          >
            {DIFFS.map((d, i) => {
              const on = d === difficulty;
              const isFirst = i === 0;
              const isLast = i === DIFFS.length - 1;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(d)}
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
                  {capitalize(d)}
                </button>
              );
            })}
          </div>
        </Step>

        {/* Save CTA */}
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full inline-flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            marginTop: 20,
            height: 46,
            borderRadius: 10,
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {saving ? 'Saving…' : 'Save & start glossing'}
        </button>

        {/* Trust pills */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {['Local-only', 'No account', 'Free tier works'].map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5"
              style={{
                height: 24,
                padding: '0 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--color-fg-muted)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: 'var(--color-accent)',
                  flex: 'none',
                }}
              />
              {t}
            </span>
          ))}
        </div>

        <div
          className="text-[var(--color-fg-subtle)]"
          style={{ marginTop: 14, fontSize: 11, lineHeight: 1.5 }}
        >
          Language, model, difficulty, and personal context are all adjustable anytime in Settings.
        </div>
      </div>
    </div>
  );
}

function Step({
  num,
  title,
  emphasized,
  children,
}: {
  num: number;
  title: string;
  emphasized?: boolean;
  children: preact.ComponentChildren;
}) {
  return (
    <div
      className="flex gap-3"
      style={{
        marginTop: 22,
        padding: emphasized ? '14px 14px 16px' : '0',
        borderRadius: emphasized ? 10 : 0,
        border: emphasized ? '1px solid var(--color-border)' : 'none',
        background: emphasized ? 'var(--color-surface)' : 'transparent',
      }}
    >
      <StepBadge num={num} filled={emphasized} />
      <div className="flex-1 min-w-0">
        <div
          className="text-[var(--color-fg)]"
          style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}
        >
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function StepBadge({ num, filled }: { num: number; filled?: boolean }) {
  return (
    <span
      className="flex-none inline-flex items-center justify-center font-semibold tabular-nums"
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        fontSize: 11,
        color: filled ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
        background: filled ? 'var(--color-accent)' : 'transparent',
        border: filled ? 'none' : '1px solid var(--color-border)',
        marginTop: 2,
      }}
    >
      {num}
    </span>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
