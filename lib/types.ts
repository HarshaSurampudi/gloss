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
  /** Default action when the player-bar screenshot button is clicked. */
  screenshotAction: 'clipboard' | 'download';
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

export interface SurfaceRequest {
  type: 'surface';
  segments: TranscriptSegment[];
  explainInLang: string;
  difficulty: string;
  model: string;
  additionalContext?: string;
  videoTitle?: string;
  videoDescription?: string;
}

export type BgResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface SurfaceResult {
  domain: string;
  concepts: Concept[];
}

export interface DetailRequest {
  type: 'detail';
  concept: Concept;
  segments: TranscriptSegment[];
  videoTitle?: string;
  videoDescription?: string;
  explainInLang: string;
  difficulty: string;
  model: string;
  additionalContext?: string;
}

export interface ScreenshotRequest {
  type: 'screenshot';
}

export interface FollowupRequest {
  type: 'followup';
  concept: Concept;
  detailText: string;
  history: { role: 'user' | 'model'; text: string }[];
  question: string;
  videoTitle?: string;
  explainInLang: string;
  model: string;
  additionalContext?: string;
}
