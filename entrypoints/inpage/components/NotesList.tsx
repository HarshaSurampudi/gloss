import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Note } from '@/lib/types';
import { addNote, deleteNote, exportAsMarkdown, updateNote } from '@/lib/notes';
import { readVideoMeta } from '@/lib/videoMeta';
import { formatTime } from '../utils';

interface NotesListProps {
  videoId: string;
  notes: Note[];
  currentT: number;
  onSeek: (t: number) => void;
  /** Legacy: used when a concept card is saved from outside — creates an
   *  empty note and switches to the Notes tab. Kept for that flow. */
  onNewNote: () => void | Promise<void>;
}

/**
 * Notes view — inspired by a marginalia-style feed:
 *   [timestamp]  •  Concept label (if linked)
 *                   Note body text, wraps naturally.
 *
 * Clicking a row enters edit mode inline. Composer is pinned to the bottom
 * as a pill input "+ Add a note…".
 */
export function NotesList({
  videoId,
  notes,
  currentT,
  onSeek,
}: NotesListProps) {
  const sorted = useMemo(() => notes.slice().sort((a, b) => a.t - b.t), [notes]);

  const exportMd = () => {
    const meta = readVideoMeta();
    const md = exportAsMarkdown(videoId, meta.title ?? 'Video notes', notes);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const safe = (meta.title ?? videoId)
      .replace(/[^\w\s-]+/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gloss-notes-${safe}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="flex items-center px-4 pt-3 pb-1.5">
              <span
                className="uppercase font-semibold text-[var(--color-fg-subtle)]"
                style={{ fontSize: 10, letterSpacing: '0.14em' }}
              >
                {sorted.length} {sorted.length === 1 ? 'note' : 'notes'}
              </span>
              <button
                type="button"
                onClick={exportMd}
                className="ml-auto inline-flex items-center gap-1 transition-colors hover:text-[var(--color-fg)]"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--color-fg-muted)',
                }}
                title="Export all notes as Markdown"
              >
                Export
              </button>
            </div>
            <ul className="list-none m-0 p-0">
              {sorted.map((n, i) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  last={i === sorted.length - 1}
                  onSeek={onSeek}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <Composer videoId={videoId} currentT={currentT} />
    </div>
  );
}

// ─── Row — display + tap-to-edit ────────────────────────────────────

function NoteRow({
  note,
  last,
  onSeek,
}: {
  note: Note;
  last: boolean;
  onSeek: (t: number) => void;
}) {
  const [editing, setEditing] = useState(
    !note.text && Date.now() - note.createdAt < 2000,
  );
  const [draft, setDraft] = useState(note.text);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(note.text);
  }, [note.text, editing]);

  useEffect(() => {
    if (editing) {
      resize(taRef.current);
      taRef.current?.focus();
      const el = taRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const commit = async () => {
    const text = draft.trim();
    setEditing(false);
    if (text === note.text) return;
    if (!text && !note.conceptLabel) {
      await deleteNote(note.videoId, note.id);
    } else {
      await updateNote(note.videoId, note.id, text);
    }
  };

  const cancel = () => {
    setDraft(note.text);
    setEditing(false);
  };

  return (
    <li
      className="group relative flex gap-3"
      style={{
        padding: '12px 14px',
        borderBottom: last
          ? 'none'
          : '1px solid var(--color-border-subtle)',
      }}
    >
      {/* Timestamp — click to seek */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSeek(note.t);
        }}
        className="flex-none font-mono tabular-nums transition-colors hover:text-[var(--color-accent)]"
        style={{
          fontSize: 11,
          color: 'var(--color-fg-subtle)',
          paddingTop: 2,
          minWidth: 34,
          textAlign: 'left',
          cursor: 'pointer',
        }}
        title={`Jump to ${formatTime(note.t)}`}
      >
        {formatTime(note.t)}
      </button>

      {/* Accent dot */}
      <span
        aria-hidden="true"
        className="flex-none"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: 'var(--color-accent)',
          marginTop: 8,
        }}
      />

      {/* Body column */}
      <div className="flex-1 min-w-0">
        {note.conceptLabel && (
          <div
            className="truncate"
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--color-accent)',
              letterSpacing: '0.005em',
              marginBottom: 2,
            }}
          >
            {note.conceptLabel}
          </div>
        )}

        {editing ? (
          <textarea
            ref={taRef}
            value={draft}
            placeholder={note.conceptLabel ? 'Add your thoughts…' : 'Jot down a thought…'}
            rows={2}
            onInput={(e) => {
              setDraft((e.target as HTMLTextAreaElement).value);
              resize(e.target as HTMLTextAreaElement);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            className="w-full bg-transparent resize-none outline-none text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)]"
            style={{ fontSize: 13, lineHeight: 1.55, maxHeight: 240 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="block w-full text-left cursor-text"
            style={{ background: 'transparent' }}
          >
            {note.text ? (
              <div
                className="whitespace-pre-wrap text-[var(--color-fg)]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                {note.text}
              </div>
            ) : (
              <div
                className="italic text-[var(--color-fg-subtle)]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                {note.conceptLabel ? 'Add your thoughts…' : 'Empty note — click to write'}
              </div>
            )}
          </button>
        )}
      </div>

      {/* Delete — appears on hover */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          deleteNote(note.videoId, note.id);
        }}
        className="flex-none inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:text-[var(--color-danger)]"
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          color: 'var(--color-fg-subtle)',
          alignSelf: 'flex-start',
          marginTop: 1,
        }}
        title="Delete note"
        aria-label="Delete note"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
        </svg>
      </button>
    </li>
  );
}

// ─── Composer — bottom pill input ────────────────────────────────────

function Composer({ videoId, currentT }: { videoId: string; currentT: number }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const save = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    resize(inputRef.current);
    await addNote(videoId, currentT, text);
  };

  useEffect(() => {
    resize(inputRef.current);
  }, [draft]);

  return (
    <div
      className="flex-none border-t border-[var(--color-border-subtle)]"
      style={{ padding: '10px 12px 12px' }}
    >
      <div
        className="flex items-start gap-2"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 10,
          padding: '7px 7px 7px 12px',
        }}
      >
        <span
          aria-hidden="true"
          className="flex-none text-[var(--color-fg-subtle)]"
          style={{ fontSize: 16, lineHeight: '26px', fontWeight: 300 }}
        >
          +
        </span>
        <textarea
          ref={inputRef}
          value={draft}
          placeholder="Add a note…"
          rows={1}
          onInput={(e) => {
            setDraft((e.target as HTMLTextAreaElement).value);
            resize(e.target as HTMLTextAreaElement);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
          className="flex-1 min-w-0 bg-transparent resize-none outline-none text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)]"
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            maxHeight: 140,
            paddingTop: 4,
            paddingBottom: 3,
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={!draft.trim()}
          className="flex-none inline-flex items-center justify-center transition-opacity disabled:opacity-0"
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            marginTop: 1,
          }}
          title={`Save at ${formatTime(currentT)} (Enter)`}
          aria-label="Save note"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center py-10">
      <div
        className="inline-flex items-center justify-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background:
            'linear-gradient(135deg, oklch(22% 0.08 268), oklch(14% 0.04 268))',
          border: '1px solid oklch(30% 0.1 268)',
          marginBottom: 12,
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="oklch(75% 0.14 268)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h2
        className="text-[var(--color-fg)]"
        style={{
          fontFamily: '"Source Serif 4", Georgia, serif',
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        No notes yet.
      </h2>
      <p
        className="text-[var(--color-fg-muted)] max-w-[240px]"
        style={{ fontSize: 12, lineHeight: 1.55, marginTop: 4 }}
      >
        Jot thoughts below or save a concept card — they'll appear here anchored to their moment.
      </p>
    </div>
  );
}

function resize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
