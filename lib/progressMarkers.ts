import type { Concept, EntityType } from './types';

/**
 * Injects colored markers onto YouTube's progress bar at each concept's
 * timestamp. Markers are small vertical ticks, clickable to seek, styled
 * in the concept-type's color. Injected into YouTube's own DOM (not our
 * shadow root) so they appear right on the scrubber.
 */

const CONTAINER_ID = 'gloss-progress-markers';
const MARKER_ATTR = 'data-gloss-marker';

const chipColor: Record<EntityType, string> = {
  CONCEPT: 'oklch(0.72 0.15 275)',
  PERSON: 'oklch(0.72 0.15 20)',
  TOOL: 'oklch(0.72 0.14 200)',
  ORGANIZATION: 'oklch(0.70 0.14 150)',
  PLACE: 'oklch(0.72 0.14 90)',
  EVENT: 'oklch(0.72 0.15 320)',
  WORK: 'oklch(0.72 0.14 50)',
  TECHNIQUE: 'oklch(0.70 0.13 230)',
  JARGON: 'oklch(0.72 0.02 260)',
};

function colorFor(t: EntityType): string {
  return chipColor[t] ?? 'oklch(0.72 0.02 260)';
}

export function updateProgressMarkers(
  concepts: Concept[],
  onSeek: (t: number) => void,
): void {
  const container = findBarContainer();
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  if (!container || !video) return;
  const duration = video.duration;
  if (!duration || !isFinite(duration)) {
    // Duration not ready yet — retry shortly.
    const retry = () => {
      video.removeEventListener('loadedmetadata', retry);
      video.removeEventListener('durationchange', retry);
      updateProgressMarkers(concepts, onSeek);
    };
    video.addEventListener('loadedmetadata', retry, { once: true });
    video.addEventListener('durationchange', retry, { once: true });
    return;
  }

  let overlay = container.querySelector<HTMLElement>(`#${CONTAINER_ID}`);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = CONTAINER_ID;
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '40',
    } as Partial<CSSStyleDeclaration>);
    container.appendChild(overlay);
  }

  // Reconcile: remove stale, add/update current.
  const seen = new Set<string>();
  for (const c of concepts) {
    const pct = Math.min(100, Math.max(0, (c.t / duration) * 100));
    seen.add(c.id);
    let m = overlay.querySelector<HTMLElement>(`[${MARKER_ATTR}="${c.id}"]`);
    if (!m) {
      m = document.createElement('div');
      m.setAttribute(MARKER_ATTR, c.id);
      Object.assign(m.style, {
        position: 'absolute',
        top: '-1px',
        bottom: '-1px',
        width: '3px',
        transform: 'translateX(-1.5px)',
        pointerEvents: 'auto',
        cursor: 'pointer',
        transition: 'width 120ms ease, opacity 120ms ease',
        opacity: '0.85',
        borderRadius: '1px',
      } as Partial<CSSStyleDeclaration>);
      m.addEventListener('mouseenter', () => {
        m!.style.width = '5px';
        m!.style.opacity = '1';
      });
      m.addEventListener('mouseleave', () => {
        m!.style.width = '3px';
        m!.style.opacity = '0.85';
      });
      m.addEventListener('click', (e) => {
        e.stopPropagation();
        onSeek(c.t);
      });
      overlay.appendChild(m);
    }
    m.style.left = pct + '%';
    m.style.background = colorFor(c.type);
    m.title = `${c.label} · ${formatTs(c.t)}`;
  }
  // Drop any markers whose concepts no longer exist.
  overlay.querySelectorAll<HTMLElement>(`[${MARKER_ATTR}]`).forEach((el) => {
    const id = el.getAttribute(MARKER_ATTR);
    if (id && !seen.has(id)) el.remove();
  });
}

export function removeProgressMarkers(): void {
  document.getElementById(CONTAINER_ID)?.remove();
}

function findBarContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.ytp-progress-bar-container') ||
    document.querySelector<HTMLElement>('.ytp-progress-bar')
  );
}

function formatTs(t: number): string {
  const s = Math.floor(t);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
