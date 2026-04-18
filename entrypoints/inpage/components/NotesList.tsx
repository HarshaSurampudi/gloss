import { useEffect, useRef, useState } from 'preact/hooks';
import type { Note } from '@/lib/types';
import { deleteNote, exportAsMarkdown, updateNote } from '@/lib/notes';
import { readVideoMeta } from '@/lib/videoMeta';
import { formatTime } from '../utils';

interface NotesListProps {
  videoId: string;
  notes: Note[];
  onSeek: (t: number) => void;
}

export function NotesList({ videoId, notes, onSeek }: NotesListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus();
  }, [editingId]);

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

  if (notes.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
        <div
          className="w-10 h-10 rounded-xl inline-flex items-center justify-center mb-3"
          style={{
            background: 'color-mix(in oklab, var(--color-accent) 10%, transparent)',
            color: 'var(--color-accent)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div className="text-[13px] font-semibold text-[var(--color-fg)] mb-1">No notes yet</div>
        <div className="text-[11.5px] text-[var(--color-fg-muted)] leading-relaxed max-w-[260px]">
          Open the full transcript, hover any line, and tap the bookmark to save a moment — with or without a note.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none flex items-center px-3 pt-2.5 pb-1.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Notes · {notes.length}
        </div>
        <button
          type="button"
          onClick={exportMd}
          className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10.5px] font-semibold text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
          title="Export notes as Markdown"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Export
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {notes.map((n) => (
          <div
            key={n.id}
            className="rounded-lg p-2.5 bg-[var(--color-surface)] border border-[var(--color-border)]"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <button
                type="button"
                onClick={() => onSeek(n.t)}
                className="inline-flex items-center gap-1 h-[20px] px-1.5 rounded-md font-mono text-[10.5px] tabular-nums text-[var(--color-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)]"
                title="Jump to this moment"
              >
                {formatTime(n.t)}
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(n.id);
                    setDraft(n.text);
                  }}
                  className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                  title="Edit"
                  aria-label="Edit note"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => deleteNote(n.videoId, n.id)}
                  className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)]"
                  title="Delete"
                  aria-label="Delete note"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>
                  </svg>
                </button>
              </div>
            </div>
            {n.segmentText && (
              <div className="text-[11px] italic text-[var(--color-fg-subtle)] leading-snug mb-1 border-l-2 pl-2" style={{ borderColor: 'color-mix(in oklab, var(--color-accent) 35%, transparent)' }}>
                {n.segmentText}
              </div>
            )}
            {editingId === n.id ? (
              <div className="mt-1">
                <textarea
                  ref={inputRef}
                  value={draft}
                  rows={3}
                  onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingId(null);
                    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      updateNote(n.videoId, n.id, draft.trim());
                      setEditingId(null);
                    }
                  }}
                  className="w-full px-2 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-[12px] leading-snug resize-none outline-none focus:border-[var(--color-accent)]"
                  placeholder="Your note…"
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      updateNote(n.videoId, n.id, draft.trim());
                      setEditingId(null);
                    }}
                    className="h-7 px-2.5 rounded-md text-[11px] font-semibold bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="h-7 px-2 rounded-md text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                  >
                    Cancel
                  </button>
                  <div className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">⌘↵ to save</div>
                </div>
              </div>
            ) : n.text.trim() ? (
              <div className="text-[12.5px] text-[var(--color-fg)] leading-relaxed whitespace-pre-wrap">
                {n.text}
              </div>
            ) : (
              <div className="text-[11.5px] italic text-[var(--color-fg-subtle)]">Bookmark · no text</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
