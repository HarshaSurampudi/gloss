import type { Concept, TranscriptSegment } from './types';

/**
 * Local per-video cache. Keeps transcripts and surfaced concepts in
 * chrome.storage.local so re-opening a video is instant. Capped by entry
 * count; least-recently-used entries are evicted on write.
 */

const CACHE_KEY = 'cache/v1';
const MAX_ENTRIES = 80;

/**
 * Per-kind schema version. Bump to invalidate all cached entries of that
 * kind without touching the others. Use this when the prompt, schema, or
 * fetching logic changes in a way that makes old entries incompatible.
 */
const TRANSCRIPT_VERSION = 1;
const CONCEPTS_VERSION = 2; // bumped: preview-handling prompt + model/context in key
const DETAIL_VERSION = 1;

interface TranscriptEntry {
  v: number;
  segments: TranscriptSegment[];
  lang: string;
  t: number;
}

interface ConceptsEntry {
  v: number;
  domain: string;
  concepts: Concept[];
  lang: string;
  difficulty: string;
  t: number;
}

interface DetailEntry {
  v: number;
  text: string;
  lang: string;
  model: string;
  t: number;
}

interface CacheShape {
  transcripts: Record<string, TranscriptEntry>;
  concepts: Record<string, ConceptsEntry>;
  details: Record<string, DetailEntry>;
}

function empty(): CacheShape {
  return { transcripts: {}, concepts: {}, details: {} };
}

async function read(): Promise<CacheShape> {
  try {
    if (!chrome.runtime?.id) return empty();
    const raw = await chrome.storage.local.get(CACHE_KEY);
    return { ...empty(), ...(raw[CACHE_KEY] ?? {}) };
  } catch {
    return empty();
  }
}

async function write(c: CacheShape): Promise<void> {
  try {
    if (!chrome.runtime?.id) return;
    await chrome.storage.local.set({ [CACHE_KEY]: c });
  } catch {
    /* ignore */
  }
}

function prune(map: Record<string, { t: number }>): void {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return;
  keys
    .sort((a, b) => map[a].t - map[b].t)
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((k) => delete map[k]);
}

function conceptsKey(
  videoId: string,
  lang: string,
  difficulty: string,
  model: string,
  contextHash: string,
): string {
  return `${videoId}::${lang}::${difficulty}::${model}::${contextHash}`;
}

function hashContext(ctx?: string): string {
  if (!ctx || !ctx.trim()) return 'none';
  // Tiny, stable 32-bit hash — enough to distinguish context strings.
  let h = 2166136261 >>> 0;
  const s = ctx.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

export async function getCachedTranscript(
  videoId: string,
): Promise<{ segments: TranscriptSegment[]; lang: string } | null> {
  const c = await read();
  const e = c.transcripts[videoId];
  if (!e || e.v !== TRANSCRIPT_VERSION) return null;
  e.t = Date.now();
  c.transcripts[videoId] = e;
  await write(c);
  return { segments: e.segments, lang: e.lang };
}

export async function setCachedTranscript(
  videoId: string,
  segments: TranscriptSegment[],
  lang: string,
): Promise<void> {
  const c = await read();
  c.transcripts[videoId] = {
    v: TRANSCRIPT_VERSION,
    segments,
    lang,
    t: Date.now(),
  };
  prune(c.transcripts);
  await write(c);
}

export async function getCachedConcepts(
  videoId: string,
  lang: string,
  difficulty: string,
  model: string,
  additionalContext?: string,
): Promise<{ domain: string; concepts: Concept[] } | null> {
  const c = await read();
  const key = conceptsKey(videoId, lang, difficulty, model, hashContext(additionalContext));
  const e = c.concepts[key];
  if (!e || e.v !== CONCEPTS_VERSION) return null;
  e.t = Date.now();
  c.concepts[key] = e;
  await write(c);
  return { domain: e.domain, concepts: e.concepts };
}

export async function setCachedConcepts(
  videoId: string,
  lang: string,
  difficulty: string,
  model: string,
  additionalContext: string | undefined,
  domain: string,
  concepts: Concept[],
): Promise<void> {
  const c = await read();
  const key = conceptsKey(videoId, lang, difficulty, model, hashContext(additionalContext));
  c.concepts[key] = {
    v: CONCEPTS_VERSION,
    domain,
    concepts,
    lang,
    difficulty,
    t: Date.now(),
  };
  prune(c.concepts);
  await write(c);
}

function detailKey(videoId: string, conceptId: string, lang: string, model: string): string {
  return `${videoId}::${conceptId}::${lang}::${model}`;
}

export async function getCachedDetail(
  videoId: string,
  conceptId: string,
  lang: string,
  model: string,
): Promise<string | null> {
  const c = await read();
  const key = detailKey(videoId, conceptId, lang, model);
  const e = c.details?.[key];
  if (!e || e.v !== DETAIL_VERSION) return null;
  e.t = Date.now();
  c.details[key] = e;
  await write(c);
  return e.text;
}

export async function setCachedDetail(
  videoId: string,
  conceptId: string,
  lang: string,
  model: string,
  text: string,
): Promise<void> {
  const c = await read();
  c.details = c.details ?? {};
  const key = detailKey(videoId, conceptId, lang, model);
  c.details[key] = {
    v: DETAIL_VERSION,
    text,
    lang,
    model,
    t: Date.now(),
  };
  prune(c.details);
  await write(c);
}

export async function clearCache(): Promise<void> {
  await write(empty());
}
