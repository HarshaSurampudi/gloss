import { mountInPage } from './inpage/mount';

/**
 * Content script entrypoint. Its ONLY job is to mount the in-page UI.
 * Everything else — transcript fetching, video-time reading, Gemini calls —
 * happens from within the mounted Preact app via its own local hooks.
 *
 * No persistent port. No tick loop. No chrome.runtime spam on invalidation.
 */
export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    mountInPage().catch((e) => console.warn('[gloss] mount failed', e));

    // Re-mount after SPA navigations that tear down #secondary.
    window.addEventListener('yt-navigate-finished', () => {
      mountInPage().catch(() => {});
    });
  },
});
