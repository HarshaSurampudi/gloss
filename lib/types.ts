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
