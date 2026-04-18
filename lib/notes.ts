import type { Note } from './types';

const KEY = 'notes/v1';

function runtimeAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

interface NotesShape {
  byVideo: Record<string, Note[]>;
}

async function read(): Promise<NotesShape> {
  if (!runtimeAlive()) return { byVideo: {} };
  try {
    const raw = await chrome.storage.local.get(KEY);
    const stored = raw?.[KEY];
    if (stored?.byVideo) return stored as NotesShape;
  } catch {
    /* ignore */
  }
  return { byVideo: {} };
}

async function write(s: NotesShape): Promise<void> {
  if (!runtimeAlive()) return;
  try {
    await chrome.storage.local.set({ [KEY]: s });
  } catch {
    /* ignore */
  }
}

export async function listNotes(videoId: string): Promise<Note[]> {
  const s = await read();
  return (s.byVideo[videoId] ?? []).slice().sort((a, b) => a.t - b.t);
}

export async function addNote(
  videoId: string,
  t: number,
  text: string,
  segmentText?: string,
): Promise<Note> {
  const s = await read();
  const now = Date.now();
  const note: Note = {
    id: crypto.randomUUID(),
    videoId,
    t,
    text,
    segmentText,
    createdAt: now,
    updatedAt: now,
  };
  s.byVideo[videoId] = [...(s.byVideo[videoId] ?? []), note];
  await write(s);
  return note;
}

export async function updateNote(videoId: string, id: string, text: string): Promise<void> {
  const s = await read();
  const list = s.byVideo[videoId] ?? [];
  const idx = list.findIndex((n) => n.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], text, updatedAt: Date.now() };
  s.byVideo[videoId] = list;
  await write(s);
}

export async function deleteNote(videoId: string, id: string): Promise<void> {
  const s = await read();
  s.byVideo[videoId] = (s.byVideo[videoId] ?? []).filter((n) => n.id !== id);
  await write(s);
}

export function onNotesChanged(cb: () => void): () => void {
  if (!runtimeAlive()) return () => {};
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb();
  };
  try {
    chrome.storage.onChanged.addListener(handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.storage.onChanged.removeListener(handler);
    } catch {
      /* ignore */
    }
  };
}

function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

export function exportAsMarkdown(videoId: string, videoTitle: string, notes: Note[]): string {
  const ytUrl = (t: number) => `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(t)}s`;
  const lines: string[] = [];
  lines.push(`# ${videoTitle || 'Video notes'}`);
  lines.push('');
  lines.push(`Source: https://www.youtube.com/watch?v=${videoId}`);
  lines.push('');
  for (const n of notes) {
    lines.push(`## [${fmt(n.t)}](${ytUrl(n.t)})`);
    if (n.segmentText) {
      lines.push(`> ${n.segmentText.replace(/\n/g, ' ')}`);
      lines.push('');
    }
    if (n.text.trim()) {
      lines.push(n.text.trim());
      lines.push('');
    }
  }
  return lines.join('\n');
}
