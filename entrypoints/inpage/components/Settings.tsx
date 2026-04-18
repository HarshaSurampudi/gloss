import { useState } from 'preact/hooks';
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
  const [cleared, setCleared] = useState(false);

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col"
      style={{ background: 'color-mix(in oklab, var(--color-bg) 95%, black)' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-subtle)]">
        <div className="text-[13px] font-semibold">Settings</div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 px-3 rounded-md text-[11.5px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
        >
          Done
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <Field label="Explain-in language">
          <select
            value={prefs.explainInLang}
            onChange={(e) => onChange({ explainInLang: (e.target as HTMLSelectElement).value })}
            className="w-full h-8 px-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[12.5px]"
          >
            {LANGUAGES.map((l) => (
              <option value={l.code} key={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Difficulty">
          <div className="grid grid-cols-4 gap-1.5">
            {DIFFS.map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => onChange({ difficulty: d })}
                className={`h-8 rounded-md text-[11px] font-medium capitalize border ${
                  prefs.difficulty === d
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[color-mix(in_oklab,var(--color-accent)_40%,transparent)]'
                    : 'bg-[var(--color-surface)] text-[var(--color-fg-muted)] border-[var(--color-border)]'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Gemini model">
          <select
            value={prefs.geminiModel}
            onChange={(e) => onChange({ geminiModel: (e.target as HTMLSelectElement).value })}
            className="w-full h-8 px-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[12.5px]"
          >
            {GEMINI_MODELS.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name} — {m.hint}
              </option>
            ))}
          </select>
          <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-subtle)] leading-relaxed">
            Uses Google's `latest` aliases so you auto-get the newest stable version without updates.
          </div>
        </Field>

        <Field label="Focus mode">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onChange({ focusMode: !prefs.focusMode })}
              role="switch"
              aria-checked={prefs.focusMode}
              className="flex-none relative rounded-full transition-colors outline-none"
              style={{
                width: '36px',
                height: '20px',
                padding: 0,
                border: 'none',
                background: prefs.focusMode ? 'var(--color-accent)' : 'var(--color-border)',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: prefs.focusMode ? '18px' : '2px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '9999px',
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                  transition: 'left 180ms cubic-bezier(0.2, 0.7, 0.2, 1)',
                }}
              />
            </button>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              {prefs.focusMode ? 'On' : 'Off'}
            </span>
          </div>
          <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-subtle)] leading-relaxed">
            Hides YouTube comments, recommended videos, Shorts shelves, and end-screen cards. Just the video and Gloss.
          </div>
        </Field>

        <Field label="Translate transcript">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onChange({ translateTranscript: !prefs.translateTranscript })}
              role="switch"
              aria-checked={prefs.translateTranscript}
              className="flex-none relative rounded-full transition-colors outline-none"
              style={{
                width: '36px',
                height: '20px',
                padding: 0,
                border: 'none',
                background: prefs.translateTranscript ? 'var(--color-accent)' : 'var(--color-border)',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: prefs.translateTranscript ? '18px' : '2px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '9999px',
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                  transition: 'left 180ms cubic-bezier(0.2, 0.7, 0.2, 1)',
                }}
              />
            </button>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              {prefs.translateTranscript ? 'On' : 'Off'}
            </span>
          </div>
          <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-subtle)] leading-relaxed">
            When on and the transcript's language differs from your explain-in language, Gloss translates the whole transcript in one Gemini call and lets you toggle views in the caption strip. Cached per video.
          </div>
        </Field>

        <Field label="Auto-generate">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onChange({ autoGenerate: !prefs.autoGenerate })}
              role="switch"
              aria-checked={prefs.autoGenerate}
              className="flex-none relative rounded-full transition-colors outline-none"
              style={{
                width: '36px',
                height: '20px',
                padding: 0,
                border: 'none',
                background: prefs.autoGenerate ? 'var(--color-accent)' : 'var(--color-border)',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: prefs.autoGenerate ? '18px' : '2px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '9999px',
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                  transition: 'left 180ms cubic-bezier(0.2, 0.7, 0.2, 1)',
                }}
              />
            </button>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              {prefs.autoGenerate ? 'On — runs automatically' : 'Off — click to generate'}
            </span>
          </div>
          <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-subtle)] leading-relaxed">
            When off, Gloss only runs Gemini when you click Generate. Cached videos still load instantly.
          </div>
        </Field>

        <Field label="Additional context (optional)">
          <textarea
            value={prefs.additionalContext ?? ''}
            onInput={(e) => onChange({ additionalContext: (e.target as HTMLTextAreaElement).value })}
            rows={3}
            placeholder="e.g. &quot;I'm a software engineer new to Kubernetes&quot; or &quot;Skip basics I already know.&quot;"
            className="w-full px-2 py-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] leading-snug resize-none outline-none focus:border-[var(--color-accent)]"
            style={{ fontFamily: 'inherit' }}
          />
          <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-subtle)] leading-relaxed">
            Included with every request so Gloss can calibrate what to surface for you.
          </div>
        </Field>

        <Field label="Gemini API key">
          <input
            type="password"
            value={prefs.geminiApiKey ?? ''}
            onInput={(e) => onChange({ geminiApiKey: (e.target as HTMLInputElement).value })}
            placeholder="AIza…"
            className="w-full h-8 px-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] font-mono"
          />
        </Field>

        <Field label="Cache">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                await clearCache();
                setCleared(true);
                setTimeout(() => setCleared(false), 1500);
              }}
              className="h-8 px-3 rounded-md text-[11.5px] font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              Clear cached videos
            </button>
            {cleared && <span className="text-[11px] text-[var(--color-accent)]">Cleared ✓</span>}
          </div>
          <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-subtle)] leading-relaxed">
            Transcripts & concepts are cached per video so re-opens are instant.
          </div>
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
