export type EntityType =
  | 'CONCEPT'
  | 'PERSON'
  | 'TOOL'
  | 'ORGANIZATION'
  | 'PLACE'
  | 'EVENT'
  | 'WORK'
  | 'TECHNIQUE'
  | 'JARGON';

export type Difficulty = 'auto' | 'beginner' | 'intermediate' | 'expert';

export interface TranscriptSegment {
  start: number;
  dur: number;
  text: string;
}

export interface Concept {
  id: string;
  label: string;
  type: EntityType;
  /** seconds into the video */
  t: number;
  /** optional short description */
  description?: string;
}

export interface Preferences {
  explainInLang: string;
  difficulty: Difficulty;
  theme: 'light' | 'dark' | 'auto';
  geminiApiKey?: string;
  geminiModel: string;
  additionalContext?: string;
  /** When false, skip auto-surfacing on new videos — the user triggers it
   *  manually via a button. Cached videos still load instantly. Default true. */
  autoGenerate: boolean;
  /** When true AND transcript language differs from explain-in language,
   *  fetch a translation of the full transcript in one Gemini call and
   *  show a toggle in the caption strip. Default false. */
  translateTranscript: boolean;
  /** Hides YouTube's comments, recommendations, Shorts shelves, and end-
   *  screen cards while watching. Default false. */
  focusMode: boolean;
}

export interface Note {
  id: string;
  videoId: string;
  /** Seconds into the video. */
  t: number;
  /** Free-form note body. Empty string = pure bookmark. */
  text: string;
  /** Snapshot of the transcript line at that moment, for context. */
  segmentText?: string;
  createdAt: number;
  updatedAt: number;
}

/** Parameters for a concept-surfacing call. */
export interface SurfaceParams {
  segments: TranscriptSegment[];
  explainInLang: string;
  difficulty: string;
  model: string;
  additionalContext?: string;
  videoTitle?: string;
  videoDescription?: string;
  /** If set, surface concepts only from this window (full transcript still sent as context). */
  focusWindow?: { startSec: number; endSec: number };
  /** Prior concepts from sibling chunks — dedup signal only. */
  priorConcepts?: Array<{ label: string; t: number }>;
  maxConcepts?: number;
}

export interface SurfaceResult {
  domain: string;
  concepts: Concept[];
}

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string };
