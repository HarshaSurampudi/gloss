import type { Concept, TranscriptSegment } from './types';

/**
 * Tiny shared store so the fullscreen overlay (a separate Preact tree
 * rendered into the fullscreen element's shadow root) can read the same
 * concepts + current time the main panel is working with.
 */
export type AppStatus =
  | 'booting'
  | 'need-key'
  | 'loading-transcript'
  | 'idle-manual'
  | 'surfacing'
  | 'ready'
  | 'no-transcript'
  | 'error';

type State = {
  concepts: Concept[];
  currentT: number;
  activeId: string | null;
  segments: TranscriptSegment[];
  appStatus: AppStatus;
};

let state: State = {
  concepts: [],
  currentT: 0,
  activeId: null,
  segments: [],
  appStatus: 'booting',
};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const liveStore = {
  getState(): State {
    return state;
  },
  setConcepts(concepts: Concept[]) {
    state = { ...state, concepts };
    emit();
  },
  setSegments(segments: TranscriptSegment[]) {
    state = { ...state, segments };
    emit();
  },
  setCurrent(currentT: number, activeId: string | null) {
    if (state.currentT === currentT && state.activeId === activeId) return;
    state = { ...state, currentT, activeId };
    emit();
  },
  setAppStatus(appStatus: AppStatus) {
    if (state.appStatus === appStatus) return;
    state = { ...state, appStatus };
    emit();
  },
  reset() {
    state = {
      concepts: [],
      currentT: 0,
      activeId: null,
      segments: [],
      appStatus: 'booting',
    };
    emit();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
