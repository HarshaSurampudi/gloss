import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { liveStore } from '@/lib/liveStore';
import type { AppStatus } from '@/lib/liveStore';
import type { Concept } from '@/lib/types';
import { chipColorVar, chipLabel, formatTime } from './utils';
import { TypeIcon } from './components/TypeIcon';

/** Auto-fade delay after the active concept stops changing (ms). */
const AUTO_HIDE_MS = 5500;

const POS_KEY = 'fsOverlayPos/v1';

interface Pos {
  x: number;
  y: number;
}

export function FullscreenOverlay() {
  const [state, setState] = useState(() => liveStore.getState());
  const [dismissed, setDismissed] = useState(false);
  const [sticky, setSticky] = useState(true); // default visible on mount
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to shared store.
  useEffect(() => {
    console.log('[gloss/fs] overlay mounted, initial state:', liveStore.getState());
    return liveStore.subscribe(() => setState(liveStore.getState()));
  }, []);

  // Load saved position on mount.
  useEffect(() => {
    try {
      if (!chrome.runtime?.id) return;
      chrome.storage.local.get(POS_KEY).then((raw) => {
        const saved = raw?.[POS_KEY];
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
          setPos(saved);
        }
      });
    } catch {
      /* ignore */
    }
  }, []);

  // Clamp to viewport when pos or window size changes.
  useEffect(() => {
    if (!pos) return;
    const clamp = () => {
      const el = panelRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.max(8, Math.min(pos.x, vw - w - 8));
      const y = Math.max(8, Math.min(pos.y, vh - h - 8));
      if (x !== pos.x || y !== pos.y) setPos({ x, y });
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [pos]);

  const onDragStart = (e: any) => {
    // Handler is bound directly to the drag-handle button, so we always start.
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      setPos({ x: ev.clientX - offsetX, y: ev.clientY - offsetY });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDragging(false);
      // Save position.
      try {
        if (chrome.runtime?.id) {
          const r = panel.getBoundingClientRect();
          chrome.storage.local.set({ [POS_KEY]: { x: r.left, y: r.top } });
        }
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const resetPos = () => {
    setPos(null);
    try {
      if (chrome.runtime?.id) chrome.storage.local.remove(POS_KEY);
    } catch {}
  };

  const activeConcept = useMemo<Concept | null>(() => {
    if (!state.activeId) return null;
    return state.concepts.find((c) => c.id === state.activeId) ?? null;
  }, [state.concepts, state.activeId]);

  // Find the most recently passed concept as a "last seen" fallback.
  const lastConcept = useMemo<Concept | null>(() => {
    const past = state.concepts.filter((c) => c.t <= state.currentT);
    return past.length ? past[past.length - 1] : null;
  }, [state.concepts, state.currentT]);

  const shown = activeConcept ?? lastConcept;

  // When sticky is off, show on active-concept change then auto-hide. When
  // sticky is on, stay visible until user dismisses.
  const hideTimer = useRef<number | undefined>(undefined);
  const lastActiveId = useRef<string | null>(null);

  useEffect(() => {
    if (sticky) {
      setVisible(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      return;
    }
    if (activeConcept && activeConcept.id !== lastActiveId.current) {
      lastActiveId.current = activeConcept.id;
      setVisible(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (!hovered) {
        hideTimer.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
      }
    }
  }, [activeConcept?.id, sticky, hovered]);

  // On hover stop fading; on leave restart the timer (only when !sticky).
  useEffect(() => {
    if (sticky) return;
    if (hovered && hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    } else if (!hovered && visible && !hideTimer.current) {
      hideTimer.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    }
    return () => {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = undefined;
      }
    };
  }, [hovered, sticky, visible]);

  // Keyboard shortcut: S toggles sticky visibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSticky((s) => {
          const next = !s;
          if (next) {
            setDismissed(false);
            setVisible(true);
          }
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (dismissed) return null;
  const show = visible && !dismissed;

  const style: Record<string, string> = {};
  if (pos) {
    style.left = pos.x + 'px';
    style.top = pos.y + 'px';
    style.right = 'auto';
  }
  if (dragging) style.transition = 'none';

  return (
    <div
      ref={panelRef}
      className={`gloss-fs-panel ${show ? 'is-visible' : ''} ${dragging ? 'dragging' : ''}`}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="complementary"
      aria-label="Gloss"
    >
      <div className="fs-head">
        <span className="fs-brand-dot" />
        <span className="fs-brand">GLOSS</span>
        <span className="fs-time">{formatTime(state.currentT)}</span>
        <button
          type="button"
          className={`fs-sticky ${sticky ? 'on' : ''}`}
          onClick={() => setSticky((s) => !s)}
          title={sticky ? 'Auto-hide (S)' : 'Keep visible (S)'}
          aria-label="Toggle sticky"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2 6h6l-5 4 2 6-5-3-5 3 2-6-5-4h6z" />
          </svg>
        </button>
        <button
          type="button"
          className="fs-close"
          onClick={() => setDismissed(true)}
          title="Dismiss"
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="fs-body">
        {shown ? (
          <div className="fs-concept" style={{ opacity: activeConcept ? 1 : 0.75 }}>
            <div className="fs-concept-head">
              <span
                className="fs-chip"
                style={{
                  color: chipColorVar(shown.type),
                  background: `color-mix(in oklab, ${chipColorVar(shown.type)} 18%, transparent)`,
                }}
              >
                <TypeIcon type={shown.type} size={10} />
                {chipLabel(shown.type)}
              </span>
              <span className="fs-ts">{formatTime(shown.t)}</span>
            </div>
            <div className="fs-label">{shown.label}</div>
            {shown.description && (
              <div className="fs-desc">{shown.description}</div>
            )}
          </div>
        ) : (
          <EmptyBodyMessage status={state.appStatus} />
        )}
      </div>

      <div className="fs-foot">
        <span>Press <kbd>S</kbd> to {sticky ? 'auto-hide' : 'keep visible'}</span>
        <button
          type="button"
          className="fs-drag-handle"
          onMouseDown={onDragStart}
          onDblClick={resetPos}
          title="Drag to move · double-click to reset"
          aria-label="Drag overlay"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="6" r="1" fill="currentColor" />
            <circle cx="15" cy="6" r="1" fill="currentColor" />
            <circle cx="9" cy="12" r="1" fill="currentColor" />
            <circle cx="15" cy="12" r="1" fill="currentColor" />
            <circle cx="9" cy="18" r="1" fill="currentColor" />
            <circle cx="15" cy="18" r="1" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function EmptyBodyMessage({ status }: { status: AppStatus }) {
  switch (status) {
    case 'need-key':
      return (
        <div className="fs-caption-hint">
          <strong>Set your Gemini API key</strong> in the Gloss panel (bottom of the video page, next to Up Next) to start seeing concepts here.
        </div>
      );
    case 'booting':
    case 'loading-transcript':
      return <div className="fs-caption-hint">Setting things up…</div>;
    case 'idle-manual':
      return (
        <div className="fs-caption-hint">
          Open the Gloss panel and click <strong>Generate concepts</strong> to begin.
        </div>
      );
    case 'surfacing':
      return <div className="fs-caption-hint">Finding concepts…</div>;
    case 'no-transcript':
      return <div className="fs-caption-hint">No transcript available for this video.</div>;
    case 'error':
      return (
        <div className="fs-caption-hint">
          Something went wrong. See the Gloss panel below the video.
        </div>
      );
    case 'ready':
    default:
      return <div className="fs-caption-hint">Waiting for the next concept…</div>;
  }
}

