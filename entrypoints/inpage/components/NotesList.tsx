import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Note } from '@/lib/types';
import { deleteNote, exportAsMarkdown, updateNote } from '@/lib/notes';
import { readVideoMeta } from '@/lib/videoMeta';
import { formatTime } from '../utils';

interface NotesListProps {
  videoId: string;
  notes: Note[];
  currentT: number;
  onSeek: (t: number) => void;
  onNewNote: () => void | Promise<void>;
  onBack: () => void;
}

export function NotesList({
  videoId,
  notes,
  currentT,
  onSeek,
  onNewNote,
  onBack,
}: NotesListProps) {
  const exportMd = () => {
    const meta = readVideoMeta();
    const md = exportAsMarkdown(videoId, meta.title ?? 'Video notes', notes);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const safe = (meta.title ?? videoId).replace(/[^\w\s-]+/g, '').replace(/\s+/g, '-').slice(0, 60);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gloss-notes-${safe}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const sorted = useMemo(() => notes.slice().sort((a, b) => a.t - b.t), [notes]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Top bar */}
      <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
          title="Back to concepts"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Concepts
        </button>
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] ml-1">
          Notes · {sorted.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {sorted.length > 0 && (
            <button
              type="button"
              onClick={exportMd}
              title="Export as Markdown"
              aria-label="Export notes as Markdown"
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* New-note button */}
      <div className="flex-none px-3 pt-2.5 pb-1.5">
        <button
          type="button"
          onClick={onNewNote}
          className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12.5px] font-semibold"
          style={{
            background: 'color-mix(in oklab, var(--color-accent) 14%, transparent)',
            color: 'var(--color-accent)',
            border: '1px dashed color-mix(in oklab, var(--color-accent) 45%, transparent)',
          }}
          title={`Add note at ${formatTime(currentT)}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New note at {formatTime(currentT)}
        </button>
      </div>

      {/* Notes list */}
      {sorted.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div
            className="w-10 h-10 rounded-xl inline-flex items-center justify-center mb-2.5"
            style={{
              background: 'color-mix(in oklab, var(--color-accent) 10%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="text-[12.5px] font-semibold text-[var(--color-fg)] mb-1">No notes yet</div>
          <div className="text-[11.5px] text-[var(--color-fg-muted)] leading-relaxed max-w-[260px]">
            Add a note at the current moment, or save a concept card into your notes from the bookmark icon.
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
          {sorted.map((n) => (
            <NoteCard key={n.id} note={n} onSeek={onSeek} />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function NoteCard({ note, onSeek }: { note: Note; onSeek: (t: number) => void }) {
  const [text, setText] = useState(note.text);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const savedText = useRef(note.text);

  // Sync when the note prop changes from outside (storage event).
  useEffect(() => {
    if (savedText.current !== note.text) {
      savedText.current = note.text;
      setText(note.text);
    }
  }, [note.text]);

  // Autosize + focus for freshly-added empty notes.
  useEffect(() => {
    resize(taRef.current);
    if (note.text === '' && note.updatedAt === note.createdAt) {
      const ts = Date.now();
      // Only focus if created within the last 2s — avoids pulling focus back
      // for old empty notes after a re-render.
      if (ts - note.createdAt < 2000) taRef.current?.focus();
    }
  }, [note.id]);

  const scheduleSave = (next: string) => {
    setText(next);
    resize(taRef.current);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (next !== savedText.current) {
        savedText.current = next;
        updateNote(note.videoId, note.id, next);
      }
    }, 400);
  };

  const flushSave = () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }
    if (text !== savedText.current) {
      savedText.current = text;
      updateNote(note.videoId, note.id, text);
    }
  };

  return (
    <div
      className="group relative rounded-lg p-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <button
          type="button"
          onClick={() => onSeek(note.t)}
          className="inline-flex items-center gap-1 h-[22px] px-2 rounded-md font-mono text-[11px] tabular-nums text-[var(--color-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] transition-colors"
          title="Jump to this moment"
        >
          {formatTime(note.t)}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => deleteNote(note.videoId, note.id)}
          className="ml-auto w-6 h-6 inline-flex items-center justify-center rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          title="Delete note"
          aria-label="Delete note"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
          </svg>
        </button>
      </div>

      <textarea
        ref={taRef}
        value={text}
        placeholder="Your thoughts… (Enter saves, Shift+Enter new line)"
        rows={1}
        onInput={(e) => scheduleSave((e.target as HTMLTextAreaElement).value)}
        onBlur={flushSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            flushSave();
            taRef.current?.blur();
          }
        }}
        className="w-full bg-transparent resize-none outline-none text-[12.5px] leading-relaxed text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)]"
        style={{ overflow: 'hidden' }}
      />
    </div>
  );
}

function resize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
