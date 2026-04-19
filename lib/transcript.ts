import type { TranscriptSegment } from './types';

/**
 * Transcript fetching. Runs in the SERVICE WORKER.
 * Strategy:
 *   1. Scrape watch-page HTML → ytInitialPlayerResponse → captionTracks → timedtext
 *   2. If that 403s or returns empty (PoToken-gated), fall back to the ANDROID
 *      Innertube client which is currently less PoToken-gated.
 */

const log = (...args: unknown[]) => console.log('[gloss/transcript]', ...args);

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  lang: string;
}

/** Per-video cache of the timedtext request components — lets us re-fetch
 *  a translated version (via YouTube's `tlang`) without stealing the
 *  PoToken again. */
const lastTrackInfo = new Map<string, { baseUrl: string; pot: string }>();

export async function fetchTranscript(
  videoId: string,
  preferLang?: string,
): Promise<TranscriptResult | null> {
  log('start', { videoId, preferLang });

  // 1. Primary: fetch watch HTML → captionTracks → steal PoToken from YouTube's
  //    own player via Performance API → fetch timedtext with valid PoToken.
  const withPot = await tryWithStolenPoToken(videoId, preferLang);
  if (withPot) return withPot;

  // 2. Fallback: DOM transcript panel (auto-click "Show transcript" in
  //    description and scrape the rendered segments).
  log('falling back to DOM transcript panel');
  const domResult = await tryDomPanel();
  if (domResult) return domResult;

  log('all strategies failed');
  return null;
}

/**
 * Click YouTube's CC button to make its own player fetch a
 * /api/timedtext?pot=... URL, read the pot from the Performance API, then
 * build our own request with that valid PoToken.
 */
async function tryWithStolenPoToken(
  videoId: string,
  preferLang?: string,
): Promise<TranscriptResult | null> {
  try {
    const html = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: 'include',
    }).then((r) => r.text());
    const player = extractInitialPlayerResponse(html);
    const tracks: CaptionTrack[] | undefined =
      player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) {
      log('no caption tracks in ytInitialPlayerResponse');
      return null;
    }

    const track = pickTrack(tracks, preferLang);

    // If a pre-roll ad is playing, YouTube's CC button targets the ad — our
    // PoToken steal relies on the main video's /api/timedtext request, which
    // won't fire until the ad is done. Wait it out.
    await waitForAdsToFinish();

    const pot = await stealPoToken();
    if (!pot) {
      log('could not steal PoToken');
      return null;
    }
    log('got PoToken', pot.slice(0, 12) + '…');

    const url = buildTimedtextUrl(track.baseUrl, pot);
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      log('timedtext http', res.status);
      return null;
    }
    const body = await res.text();
    if (!body.trim()) {
      log('timedtext empty body even with PoToken');
      return null;
    }

    // Try JSON first, then XML.
    let segments: TranscriptSegment[] = [];
    try {
      const data = JSON.parse(body);
      segments = parseJson3(data);
    } catch {
      segments = parseXmlTimedtext(body);
    }
    if (segments.length === 0) return null;
    lastTrackInfo.set(videoId, { baseUrl: track.baseUrl, pot });
    log('OK with stolen PoToken', { lang: track.languageCode, segments: segments.length });
    return { segments, lang: track.languageCode };
  } catch (e) {
    log('stolen-pot strategy threw', e);
    return null;
  }
}

/**
 * Re-fetch the same track with YouTube's auto-translate applied. Uses the
 * `&tlang=<target>` parameter — YouTube routes through Google Translate
 * on its side, returns json3 with translated utf8. Needs the PoToken and
 * baseUrl from an earlier successful fetchTranscript call for the same
 * videoId; returns null if we don't have them (e.g., DOM-fallback path).
 */
export async function fetchTranslatedSegments(
  videoId: string,
  targetLang: string,
): Promise<string[] | null> {
  const info = lastTrackInfo.get(videoId);
  if (!info) {
    log('translate: no cached track info for', videoId);
    return null;
  }
  try {
    const url = new URL(info.baseUrl);
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('c', 'WEB');
    url.searchParams.set('pot', info.pot);
    url.searchParams.set('tlang', targetLang);
    const res = await fetch(url.toString(), { credentials: 'include' });
    if (!res.ok) {
      log('translate: tlang http', res.status);
      return null;
    }
    const body = await res.text();
    if (!body.trim()) return null;
    const data = JSON.parse(body);
    const segs = parseJson3(data);
    if (segs.length === 0) return null;
    log('translate: OK', { targetLang, segments: segs.length });
    return segs.map((s) => s.text);
  } catch (e) {
    log('translate threw', e);
    return null;
  }
}

function pickTrack(tracks: CaptionTrack[], preferLang?: string): CaptionTrack {
  return (
    (preferLang && tracks.find((t) => t.languageCode === preferLang && t.kind !== 'asr')) ||
    (preferLang && tracks.find((t) => t.languageCode === preferLang)) ||
    tracks.find((t) => t.kind !== 'asr') ||
    tracks[0]
  );
}

function buildTimedtextUrl(baseUrl: string, pot: string): string {
  const u = new URL(baseUrl);
  u.searchParams.set('fmt', 'json3');
  u.searchParams.set('c', 'WEB');
  u.searchParams.set('pot', pot);
  return u.toString();
}

/**
 * Click YouTube's CC button twice (toggle). Its network activity hits
 * /api/timedtext?…&pot=…. Poll Performance API for that URL and pull out
 * the `pot` param.
 */
function stealPoToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const btn =
      document.querySelector<HTMLButtonElement>(
        '#movie_player button.ytp-subtitles-button.ytp-button',
      ) ||
      document.querySelector<HTMLButtonElement>('button.ytp-subtitles-button.ytp-button');
    if (!btn) return resolve(null);

    try {
      performance.clearResourceTimings();
    } catch {}

    const onClick = async () => {
      for (let i = 0; i <= 500; i += 50) {
        await new Promise((r) => setTimeout(r, 50));
        const entry = performance
          .getEntriesByType('resource')
          .filter((e) => e.name.includes('/api/timedtext?'))
          .pop();
        if (!entry) continue;
        try {
          const pot = new URL((entry as PerformanceResourceTiming).name).searchParams.get('pot');
          if (pot) return resolve(pot);
        } catch {
          /* keep polling */
        }
      }
      resolve(null);
    };

    btn.addEventListener('click', onClick, { once: true });
    btn.click(); // toggle on
    btn.click(); // toggle off — back to original state
  });
}

function parseJson3(data: any): TranscriptSegment[] {
  const events = (data.events ?? []) as Array<{
    tStartMs: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
  return events
    .filter((e) => e.segs?.some((s) => s.utf8))
    .map((e) => ({
      start: e.tStartMs / 1000,
      dur: (e.dDurationMs ?? 0) / 1000,
      text: (e.segs ?? [])
        .map((s) => s.utf8 ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((s) => s.text.length > 0);
}

async function tryDomPanel(): Promise<TranscriptResult | null> {
  // 1. If the panel is already open, read it.
  const existing = readPanel();
  if (existing) return existing;

  // 2. Try to open it: YouTube exposes a "Show transcript" button inside
  //    the description's "…more" panel. Click heuristic.
  try {
    // Expand description if collapsed.
    const expand = document.querySelector<HTMLElement>('tp-yt-paper-button#expand');
    expand?.click();
    await wait(200);

    // Find any button whose aria-label contains "transcript".
    const showBtn = findByLabel(/transcript/i);
    if (showBtn) {
      showBtn.click();
      log('clicked "Show transcript" button');
    } else {
      log('no Show-transcript button found');
      return null;
    }
    // Wait for segments to render.
    for (let i = 0; i < 20; i++) {
      await wait(250);
      const r = readPanel();
      if (r) return r;
    }
    return null;
  } catch (e) {
    log('dom open failed', e);
    return null;
  }
}

function readPanel(): TranscriptResult | null {
  const nodes = document.querySelectorAll('ytd-transcript-segment-renderer');
  if (nodes.length === 0) return null;
  const segments: TranscriptSegment[] = [];
  nodes.forEach((el) => {
    const tsEl = el.querySelector('.segment-timestamp') as HTMLElement | null;
    const textEl = el.querySelector('.segment-text') as HTMLElement | null;
    if (!tsEl || !textEl) return;
    segments.push({
      start: parseTimestamp(tsEl.innerText.trim()),
      dur: 0,
      text: textEl.innerText.trim(),
    });
  });
  if (segments.length === 0) return null;
  log('dom: scraped', { segments: segments.length });
  return { segments, lang: document.documentElement.lang || 'en' };
}

function findByLabel(pattern: RegExp): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('button, tp-yt-paper-button, yt-button-shape, [role="button"]');
  for (const el of all) {
    const label = el.getAttribute('aria-label') || el.textContent || '';
    if (pattern.test(label)) return el;
  }
  return null;
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function isAdPlaying(): boolean {
  const mp = document.getElementById('movie_player');
  if (!mp) return false;
  return (
    mp.classList.contains('ad-showing') ||
    mp.classList.contains('ad-interrupting')
  );
}

/**
 * If YouTube is currently running a pre-roll or mid-roll ad, hold off on the
 * CC-button steal until the ad ends. Times out after 90s so a broken ad-break
 * never strands transcript fetching forever — we'll fall through to the DOM
 * panel in that case.
 */
async function waitForAdsToFinish(timeoutMs = 90_000): Promise<void> {
  if (!isAdPlaying()) return;
  log('ad is playing — waiting for it to finish before fetching transcript');
  const start = Date.now();
  while (isAdPlaying() && Date.now() - start < timeoutMs) {
    await wait(500);
  }
  if (isAdPlaying()) {
    log('gave up waiting for ad after', timeoutMs, 'ms');
    return;
  }
  // Small grace period for the main video's player state to settle after the
  // ad ends (CC button reattaches, tracks re-register).
  await wait(400);
}

function parseTimestamp(s: string): number {
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function parseXmlTimedtext(xml: string): TranscriptSegment[] {
  // Simple parser for YouTube's XML timedtext format.
  const segs: TranscriptSegment[] = [];
  const re = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const start = parseFloat(m[1]);
    const dur = m[2] ? parseFloat(m[2]) : 0;
    const text = m[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) segs.push({ start, dur, text });
  }
  return segs;
}

function extractInitialPlayerResponse(html: string): any | null {
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>|window\[)/s,
    /ytInitialPlayerResponse"\s*\)\s*\|\|\s*(\{.+?\})\s*;/s,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        /* try next */
      }
    }
  }
  return null;
}
