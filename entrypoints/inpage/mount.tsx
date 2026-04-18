import { render } from 'preact';
import { App } from './App';
import { FullscreenOverlay } from './FullscreenOverlay';
import { liveStore } from '@/lib/liveStore';
import sheet from '@/assets/styles.css?inline';
import fullscreenSheet from '@/assets/fullscreen.css?inline';

const CONTAINER_ID = 'gloss-container';

/** Mount-point selectors, ordered by preference. */
const MOUNT_SELECTORS = [
  '#secondary.style-scope.ytd-watch-flexy',
  '#related.style-scope.ytd-watch-flexy',
  '#related.style-scope.ytd-watch-grid',
  '#secondary.style-scope.ytd-watch-grid',
];

let lastVideoId: string | null = null;
let navWatcherStarted = false;

export async function mountInPage(): Promise<void> {
  startNavWatcher();

  const videoId = new URL(location.href).searchParams.get('v');
  if (!videoId) return;

  // If we're on a new video, tear down old mount and re-create so App is fresh.
  if (lastVideoId && lastVideoId !== videoId) {
    document.getElementById(CONTAINER_ID + '-wrapper')?.remove();
    liveStore.reset();
  }
  if (document.getElementById(CONTAINER_ID) && lastVideoId === videoId) return;

  const target = await waitForAny(MOUNT_SELECTORS, 30000);
  if (!target) return;

  // Outer wrapper — guarantees a gap below the panel regardless of how
  // YouTube's flex/grid layout handles margin on the shadow host.
  const wrapper = document.createElement('div');
  wrapper.id = CONTAINER_ID + '-wrapper';
  wrapper.style.display = 'block';
  wrapper.style.paddingBottom = '32px';
  target.insertBefore(wrapper, target.firstChild);

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  wrapper.appendChild(container);

  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = sheet as string;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.id = 'gloss-root';
  shadow.appendChild(root);

  syncYouTubeTheme(container);
  matchVideoPlayerHeight(container);
  trapKeystrokes(container);
  installFullscreenOverlay();
  lastVideoId = videoId;
  render(<App videoId={videoId} />, root);
}

/**
 * Stop keyboard events that originate from our inputs/textareas from
 * bubbling out to YouTube — otherwise typing "m" in a Gloss field
 * triggers YouTube's mute shortcut, "f" triggers fullscreen, etc.
 */
function trapKeystrokes(host: HTMLElement): void {
  const isEditable = (e: Event): boolean => {
    const path = e.composedPath() as HTMLElement[];
    return path.some(
      (n) =>
        n &&
        (n.tagName === 'INPUT' ||
          n.tagName === 'TEXTAREA' ||
          n.tagName === 'SELECT' ||
          (n as any).isContentEditable === true),
    );
  };
  const stop = (e: Event) => {
    if (isEditable(e)) e.stopPropagation();
  };
  host.addEventListener('keydown', stop);
  host.addEventListener('keyup', stop);
  host.addEventListener('keypress', stop);
}

// ─────────────────────── Immersive overlay (theater + fullscreen) ───────────────────────
// Triggers in two cases:
//   1) Browser fullscreen API active (F key / fullscreen button)
//   2) YouTube "theater mode" — <ytd-watch-flexy theater> attribute present
// In either case we hide the main side panel and show the compact overlay
// instead, mounted inside the player/fullscreen element so it actually paints.

const FS_CONTAINER_ID = 'gloss-fs-container';
let fullscreenInstalled = false;

function installFullscreenOverlay() {
  if (fullscreenInstalled) return;
  fullscreenInstalled = true;

  const detect = (): { immersive: boolean; target: HTMLElement | null } => {
    const fsEl = (document.fullscreenElement ||
      (document as any).webkitFullscreenElement) as HTMLElement | null;
    if (fsEl) return { immersive: true, target: fsEl };

    const flexy = document.querySelector('ytd-watch-flexy') as HTMLElement | null;
    const inTheater = !!flexy?.hasAttribute('theater');
    if (inTheater) {
      const player =
        (document.querySelector('#movie_player') as HTMLElement | null) ||
        (document.querySelector('ytd-player') as HTMLElement | null);
      return { immersive: true, target: player };
    }
    return { immersive: false, target: null };
  };

  const sync = () => {
    const { immersive, target } = detect();
    const existing = document.getElementById(FS_CONTAINER_ID);
    const mainWrapper = document.getElementById('gloss-container-wrapper');
    console.log('[gloss/fs] sync', { immersive, target, existingMount: !!existing });

    if (immersive && target) {
      // Hide main panel.
      if (mainWrapper) mainWrapper.style.display = 'none';

      // (Re)mount overlay if missing or attached to the wrong target.
      if (!existing || existing.parentElement !== target) {
        existing?.remove();
        const host = document.createElement('div');
        host.id = FS_CONTAINER_ID;
        host.style.position = 'absolute';
        host.style.inset = '0';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '2147483647';
        target.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = fullscreenSheet as string;
        shadow.appendChild(style);
        const mount = document.createElement('div');
        shadow.appendChild(mount);
        trapKeystrokes(host);
        render(<FullscreenOverlay />, mount);
      }
    } else {
      // Show main panel, tear down overlay.
      if (mainWrapper) mainWrapper.style.display = '';
      existing?.remove();
    }
  };

  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  // Observe theater-mode toggles — YouTube flips the `theater` attribute on
  // <ytd-watch-flexy>. Also re-sync on navigations.
  const observeTheater = () => {
    const flexy = document.querySelector('ytd-watch-flexy');
    if (!flexy) return;
    new MutationObserver(sync).observe(flexy, {
      attributes: true,
      attributeFilter: ['theater', 'fullscreen'],
    });
  };
  observeTheater();
  window.addEventListener('yt-navigate-finished', () => {
    setTimeout(() => {
      observeTheater();
      sync();
    }, 300);
  });

  sync();
}

/**
 * Keep the panel's height equal to YouTube's video player area so the two
 * align flush. YouTube's layout changes on resize, theater-mode toggle, and
 * fullscreen — observe and re-sync. Falls back to the CSS clamp if the
 * player isn't found.
 */
function matchVideoPlayerHeight(host: HTMLElement) {
  const find = () =>
    document.querySelector<HTMLElement>('ytd-watch-flexy #player.ytd-watch-flexy') ||
    document.querySelector<HTMLElement>('#player-container-inner') ||
    document.querySelector<HTMLElement>('#movie_player') ||
    document.querySelector<HTMLElement>('#player');

  const apply = () => {
    const player = find();
    if (!player) return;
    const h = player.getBoundingClientRect().height;
    if (h > 200) host.style.height = h + 'px';
  };

  apply();
  // Re-apply on next frame in case YouTube is still laying out.
  requestAnimationFrame(apply);
  setTimeout(apply, 500);

  const player = find();
  if (player && 'ResizeObserver' in window) {
    new ResizeObserver(apply).observe(player);
  }
  window.addEventListener('resize', apply);
  window.addEventListener('yt-navigate-finished', () => setTimeout(apply, 500));
}

/**
 * YouTube's `yt-navigate-finished` event is unreliable in some SPA
 * transitions. Layer multiple detectors so a video change is always caught:
 *   1. yt-navigate-finished + yt-page-data-updated events
 *   2. History API wrapper (pushState / replaceState / popstate)
 *   3. A 400ms polling fallback on location.search?v=...
 */
function startNavWatcher() {
  if (navWatcherStarted) return;
  navWatcherStarted = true;

  const check = () => {
    const vid = new URL(location.href).searchParams.get('v');
    if (vid && vid !== lastVideoId) {
      mountInPage().catch(() => {});
    }
  };

  window.addEventListener('yt-navigate-finished', check);
  document.addEventListener('yt-page-data-updated', check);
  window.addEventListener('popstate', check);

  // Wrap pushState / replaceState so we catch programmatic SPA nav.
  const wrap = (name: 'pushState' | 'replaceState') => {
    const orig = history[name];
    history[name] = function (this: History, ...args: any[]) {
      const ret = orig.apply(this, args as any);
      setTimeout(check, 0);
      return ret;
    } as any;
  };
  try {
    wrap('pushState');
    wrap('replaceState');
  } catch {
    /* some environments forbid patching */
  }

  // Safety net — catches any missed transitions.
  setInterval(check, 400);
}

function waitForAny(selectors: string[], timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const tryNow = () => {
      for (const s of selectors) {
        const el = document.querySelector<HTMLElement>(s);
        if (el) return el;
      }
      return null;
    };
    const initial = tryNow();
    if (initial) return resolve(initial);

    const obs = new MutationObserver(() => {
      const el = tryNow();
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

function syncYouTubeTheme(host: HTMLElement) {
  const html = document.documentElement;
  const apply = () => {
    if (html.hasAttribute('dark')) host.classList.add('theme-dark');
    else host.classList.remove('theme-dark');
  };
  apply();
  new MutationObserver(apply).observe(html, {
    attributes: true,
    attributeFilter: ['dark'],
  });
}
