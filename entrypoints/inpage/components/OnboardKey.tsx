import { useState } from 'preact/hooks';

interface OnboardKeyProps {
  onSave: (key: string) => void | Promise<void>;
}

export function OnboardKey({ onSave }: OnboardKeyProps) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!key.trim() || saving) return;
    setSaving(true);
    await onSave(key.trim());
  };

  return (
    <div className="flex-1 flex flex-col justify-center px-5 py-6">
      <div className="mb-5 inline-flex w-10 h-10 rounded-xl items-center justify-center"
        style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
        </svg>
      </div>
      <h2 className="text-[16px] font-bold mb-1 leading-tight">Connect Gemini</h2>
      <p className="text-[12.5px] text-[var(--color-fg-muted)] leading-relaxed mb-4">
        Gloss is fully local — your API key stays on your device. Free keys work great.
      </p>
      <a
        href="https://aistudio.google.com/app/apikey"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[12px] text-[var(--color-accent)] hover:underline mb-3"
      >
        Get a free key from Google AI Studio →
      </a>
      <input
        type="password"
        value={key}
        onInput={(e) => setKey((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="AIza…"
        className="w-full h-9 px-3 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[12.5px] font-mono text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-accent)]"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!key.trim() || saving}
        className="mt-3 h-9 px-3 rounded-md text-[12px] font-semibold bg-[var(--color-accent)] text-[var(--color-accent-fg)] disabled:opacity-40 hover:brightness-110"
      >
        {saving ? 'Saving…' : 'Save & continue'}
      </button>
      <div className="mt-3 text-[10.5px] text-[var(--color-fg-subtle)] leading-relaxed">
        You can change language, model, difficulty, and add personal context later in Settings (⚙️).
      </div>
    </div>
  );
}
