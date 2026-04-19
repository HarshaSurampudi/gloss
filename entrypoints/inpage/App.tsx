import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  CallResult,
  Concept,
  Preferences,
  SurfaceParams,
  SurfaceResult,
  TranscriptSegment,
} from '@/lib/types';
import { getPrefs, onPrefsChanged, setPrefs } from '@/lib/storage';
import { fetchTranscript, fetchTranslatedSegments } from '@/lib/transcript';
import { liveStore } from '@/lib/liveStore';
import {
  getCachedConcepts,
  getCachedTranscript,
  getCachedTranslation,
  setCachedConcepts,
  setCachedTranscript,
  setCachedTranslation,
} from '@/lib/cache';
import { removeProgressMarkers, updateProgressMarkers } from '@/lib/progressMarkers';
import { readVideoMeta } from '@/lib/videoMeta';
import { setFocusMode } from '@/lib/focusMode';
import { generateVideoSummary, surfaceConcepts } from '@/lib/gemini';
import type { KeyMoment } from '@/lib/gemini';
import { getCachedSummary, setCachedSummary } from '@/lib/cache';
import { GlossLogo } from './components/GlossLogo';
import { Tabs } from './components/Tabs';
import type { TabKey } from './components/Tabs';
import { Header } from './components/Header';
import { ConceptsList } from './components/ConceptsList';
import { CaptionStrip } from './components/CaptionStrip';
import { Timeline } from './components/Timeline';
import { Settings } from './components/Settings';
import { OnboardKey } from './components/OnboardKey';
import { ConceptDetail } from './components/ConceptDetail';
import { NotesList } from './components/NotesList';
import type { Note } from '@/lib/types';
import { addNote, listNotes, onNotesChanged } from '@/lib/notes';

interface AppProps {
  videoId: string;
}

type Status =
  | 'loading-prefs'
  | 'need-key'
  | 'loading-transcript'
  | 'idle-manual'   // transcript loaded, waiting for user to click "Generate"
  | 'surfacing'
  | 'ready'
  | 'no-transcript'
  | 'error';

export function App({ videoId }: AppProps) {
  const [prefs, setPrefsState] = useState<Preferences | null>(null);
  const [status, setStatus] = useState<Status>('loading-prefs');
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptLang, setTranscriptLang] = useState<string | undefined>();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [domain, setDomain] = useState<string | null>(null);
  const [currentT, setCurrentT] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [translatedTexts, setTranslatedTexts] = useState<string[] | null>(null);
  const [translating, setTranslating] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('concepts');
  const [notes, setNotes] = useState<Note[]>([]);
  const [surfaceProgress, setSurfaceProgress] = useState<{ done: number; total: number } | null>(null);
  const [failedWindows, setFailedWindows] = useState<Array<{ startSec: number; endSec: number }>>([]);
  const [processedWindows, setProcessedWindows] = useState<Array<{ startSec: number; endSec: number }>>([]);
  // True between user-click-Stop and the surfacing loop actually exiting. The
  // banner reads this to show "Stopping…" instead of the progress label.
  const [stopping, setStopping] = useState(false);

  // Video summary + key moments (optional, pref-gated).
  const [summary, setSummary] = useState('');
  const [keyMoments, setKeyMoments] = useState<KeyMoment[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const forceRegen = useRef(false);
  // User-initiated cancel for the in-flight surfacing run. Flipped by the
  // Stop button; read by the chunking loop.
  const userCancelledRef = useRef(false);
  /** Per-window concept results, keyed by startSec. Kept so we can re-run merge
   *  after a user-triggered retry of a single failed window. */
  const chunkResultsRef = useRef<Map<number, { concepts: Concept[]; domain: string }>>(new Map());
  /** Which model the current successful chunk results were generated with, so
   *  a manual retry uses the same model and a cache write stays consistent. */
  const surfaceRunCtxRef = useRef<{
    model: string;
    difficulty: string;
    lang: string;
    extraCtx?: string;
    videoId: string;
  } | null>(null);

  // Ref to the YouTube <video> element; updated lazily so seeks work even if
  // the element mounts later.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const getVideo = () => {
    if (!videoRef.current || !document.contains(videoRef.current)) {
      videoRef.current = document.querySelector<HTMLVideoElement>('video.html5-main-video');
    }
    return videoRef.current;
  };

  // Load prefs.
  useEffect(() => {
    let cancelled = false;
    getPrefs().then((p) => {
      if (cancelled) return;
      setPrefsState(p);
      setStatus(p.geminiApiKey ? 'loading-transcript' : 'need-key');
    });
    const off = onPrefsChanged((p) => setPrefsState(p));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Fetch transcript once we have a key. Uses cache first.
  useEffect(() => {
    if (!prefs?.geminiApiKey || status === 'loading-prefs' || status === 'need-key') return;
    if (status !== 'loading-transcript') return;
    let cancelled = false;
    (async () => {
      const afterTranscript = async () => {
        // Decide: use cache → surface → or wait for manual trigger.
        const difficulty = prefs.difficulty === 'auto' ? 'intermediate' : prefs.difficulty;
        const cachedConcepts = await getCachedConcepts(
          videoId,
          prefs.explainInLang,
          difficulty,
          prefs.geminiModel,
          prefs.additionalContext,
        );
        if (cancelled) return;
        if (cachedConcepts) {
          setDomain(cachedConcepts.domain);
          setConcepts(cachedConcepts.concepts);
          setStatus('ready');
          return;
        }
        if (prefs.autoGenerate) setStatus('surfacing');
        else setStatus('idle-manual');
      };

      const cachedTr = await getCachedTranscript(videoId);
      if (cancelled) return;
      if (cachedTr) {
        setSegments(cachedTr.segments);
        setTranscriptLang(cachedTr.lang);
        await afterTranscript();
        return;
      }
      const r = await fetchTranscript(videoId, prefs.explainInLang);
      if (cancelled) return;
      if (!r) {
        setStatus('no-transcript');
        return;
      }
      setSegments(r.segments);
      setTranscriptLang(r.lang);
      setCachedTranscript(videoId, r.segments, r.lang);
      await afterTranscript();
    })();
    return () => {
      cancelled = true;
    };
  }, [prefs?.geminiApiKey, prefs?.explainInLang, prefs?.autoGenerate, videoId, status]);

  // Surface concepts via SW once transcript is ready. Uses cache first.
  // Long videos are chunked into 10-minute windows and surfaced sequentially.
  // Each chunk receives the concepts already surfaced in earlier chunks as a
  // dedup signal. Concepts stream into the UI as each chunk completes so the
  // user sees progress. Some duplicates are tolerated — a light post-hoc dedup
  // by concept id is enough.
  useEffect(() => {
    if (status !== 'surfacing' || !prefs) return;
    const difficulty = prefs.difficulty === 'auto' ? 'intermediate' : prefs.difficulty;
    const model = prefs.geminiModel;
    const extraCtx = prefs.additionalContext;
    let cancelled = false;
    userCancelledRef.current = false;
    (async () => {
      const skipCache = forceRegen.current;
      forceRegen.current = false;
      const cached = skipCache
        ? null
        : await getCachedConcepts(videoId, prefs.explainInLang, difficulty, model, extraCtx);
      if (cancelled) return;
      if (cached) {
        setDomain(cached.domain);
        setConcepts(cached.concepts);
        setStatus('ready');
        return;
      }

      const meta = readVideoMeta();
      const duration = segments.reduce((m, s) => Math.max(m, s.start + (s.dur || 0)), 0);
      const CHUNK_SEC = 600; // 10 min
      const allWindows: Array<{ startSec: number; endSec: number }> = [];
      for (let s = 0; s < Math.max(duration, 1); s += CHUNK_SEC) {
        allWindows.push({ startSec: s, endSec: Math.min(duration, s + CHUNK_SEC) });
      }
      const windows = allWindows.filter((w) =>
        segments.some((seg) => seg.start >= w.startSec && seg.start < w.endSec),
      );

      chunkResultsRef.current = new Map();
      surfaceRunCtxRef.current = {
        model,
        difficulty,
        lang: prefs.explainInLang,
        extraCtx,
        videoId,
      };
      setFailedWindows([]);
      setProcessedWindows([]);

      setStopping(false);

      // Short videos: single full-transcript call, no chunking.
      if (windows.length <= 1) {
        setSurfaceProgress({ done: 0, total: 1 });
        const req: SurfaceParams = {
          segments,
          explainInLang: prefs.explainInLang,
          difficulty,
          model,
          additionalContext: extraCtx,
          videoTitle: meta.title,
          videoDescription: meta.description,
          thinkingLevel: prefs.thinkingLevel,
        };
        const resp = await runWithRetry(
          req,
          prefs.geminiApiKey!,
          3,
          () => cancelled || userCancelledRef.current,
        );
        if (cancelled || userCancelledRef.current) {
          userCancelledRef.current = false;
          setSurfaceProgress(null);
          setStopping(false);
          setStatus('idle-manual');
          return;
        }
        setSurfaceProgress(null);
        if (!resp.ok) {
          setError(resp.error);
          setStatus('error');
          return;
        }
        setDomain(resp.data.domain);
        setConcepts(resp.data.concepts);
        setStatus('ready');
        setCachedConcepts(
          videoId,
          prefs.explainInLang,
          difficulty,
          model,
          extraCtx,
          resp.data.domain,
          resp.data.concepts,
        );
        return;
      }

      // Long videos: pipelined chunked surfacing. Up to CONCURRENCY requests
      // may be in flight at once (spaced by LAUNCH_SPACING_MS to stay under
      // RPM limits), but results commit to the UI and to the priorConcepts
      // snapshot in strict launch order — so the user sees concepts appear
      // chronologically and later chunks still benefit from earlier dedup.
      const total = windows.length;
      const CONCURRENCY = 2;
      const LAUNCH_SPACING_MS = 1200;
      // Latched when the React unmount/video-change cleanup fires or the
      // user clicks Stop. Hoisted so the cooldown waiter can see it.
      const isBailed = () => cancelled || userCancelledRef.current;
      // When a 429 fires, every worker that hasn't launched yet waits until
      // this timestamp before firing its first request. This converts one
      // worker's rate-limit signal into a pipeline-wide cooldown so we stop
      // hammering the server while it's asking us to slow down.
      let rateLimitCooldownUntil = 0;
      const markRateLimit = () => {
        // 20s is longer than Gemini's per-minute RPM bucket refill, so one
        // stall usually clears the burst. We don't parse Retry-After because
        // Gemini's error bodies don't consistently include it.
        rateLimitCooldownUntil = Math.max(rateLimitCooldownUntil, Date.now() + 20000);
      };
      const waitForCooldown = async () => {
        while (Date.now() < rateLimitCooldownUntil && !isBailed()) {
          await new Promise((r) => setTimeout(r, 250));
        }
      };
      setSurfaceProgress({ done: 0, total });
      console.log(
        `[gloss/surface] video ${videoId}: duration=${Math.floor(duration)}s, ${windows.length} chunks of ${CHUNK_SEC}s (concurrency=${CONCURRENCY}, spacing=${LAUNCH_SPACING_MS}ms)`,
      );

      const failed: Array<{ startSec: number; endSec: number }> = [];
      const accumulated: Concept[] = [];
      let firstDomain = '';
      const seenIds = new Set<string>();
      let committedCount = 0;

      // Pending results keyed by launch index, committed in order.
      const pending = new Map<number, { window: { startSec: number; endSec: number }; resp: CallResult<SurfaceResult> }>();
      let nextCommitIdx = 0;
      const commitReady = () => {
        while (pending.has(nextCommitIdx)) {
          const { window: w, resp } = pending.get(nextCommitIdx)!;
          pending.delete(nextCommitIdx);
          nextCommitIdx += 1;
          const segmentCount = segments.filter(
            (s) => s.start >= w.startSec && s.start < w.endSec,
          ).length;
          if (resp.ok) {
            console.log(
              `[gloss/surface] chunk ${Math.floor(w.startSec)}-${Math.floor(w.endSec)}s: ${segmentCount} lines → ${resp.data.concepts.length} concepts`,
              resp.data.concepts.map((c) => `${Math.floor(c.t)}s ${c.label}`),
            );
            chunkResultsRef.current.set(w.startSec, {
              concepts: resp.data.concepts,
              domain: resp.data.domain,
            });
            if (!firstDomain && resp.data.domain) firstDomain = resp.data.domain;
            for (const c of resp.data.concepts) {
              if (seenIds.has(c.id)) continue;
              seenIds.add(c.id);
              accumulated.push(c);
            }
            accumulated.sort((a, b) => a.t - b.t);
            setDomain(firstDomain);
            setConcepts([...accumulated]);
          } else {
            console.warn(
              `[gloss/surface] chunk ${Math.floor(w.startSec)}-${Math.floor(w.endSec)}s: FAILED (${segmentCount} lines) — ${resp.error}`,
            );
            failed.push(w);
            setFailedWindows([...failed]);
          }
          setProcessedWindows((prev) => [...prev, w]);
          committedCount += 1;
          setSurfaceProgress({ done: committedCount, total });
        }
      };

      const inflight = new Set<Promise<void>>();
      let launchedCount = 0;
      for (let i = 0; i < windows.length; i++) {
        if (isBailed()) break;
        // Throttle launches to stay under RPM and to avoid bursting.
        if (i > 0) await new Promise((r) => setTimeout(r, LAUNCH_SPACING_MS));
        if (isBailed()) break;
        // If at concurrency cap, wait for any in-flight to settle.
        if (inflight.size >= CONCURRENCY) {
          await Promise.race(inflight);
          if (isBailed()) break;
        }
        // If a recent request hit 429, pipeline-wide pause before launching.
        await waitForCooldown();
        if (isBailed()) break;
        const idx = i;
        const w = windows[idx];
        launchedCount = idx + 1;
        // Snapshot priors at launch time — reflects everything committed so
        // far, which is a subset of what will eventually be known. Later
        // chunks may miss dedup hints from chunks still in flight, but that's
        // the trade-off for overlap; naive id-dedup on commit catches the
        // obvious duplicates.
        const priorConcepts = accumulated.map((c) => ({ label: c.label, t: c.t }));
        const req: SurfaceParams = {
          segments,
          explainInLang: prefs.explainInLang,
          difficulty,
          model,
          additionalContext: extraCtx,
          videoTitle: meta.title,
          videoDescription: meta.description,
          focusWindow: w,
          priorConcepts,
          maxConcepts: 6,
          thinkingLevel: prefs.thinkingLevel,
        };
        const p = (async () => {
          const resp = await runWithRetry(
            req,
            prefs.geminiApiKey!,
            3,
            isBailed,
            markRateLimit,
          );
          // Drop results that arrive after we've bailed — user has already
          // moved on (cancelled or navigated away).
          if (isBailed()) return;
          pending.set(idx, { window: w, resp });
          commitReady();
        })();
        inflight.add(p);
        p.finally(() => inflight.delete(p));
      }

      // Drain in-flight requests, but bail immediately if the user clicks
      // Stop mid-drain. Orphan requests will complete in the background
      // without touching state (isBailed() is checked in their commit
      // handler too).
      while (inflight.size > 0 && !isBailed()) {
        await Promise.race(inflight);
      }
      if (cancelled) return;

      setSurfaceProgress(null);
      setStopping(false);

      if (userCancelledRef.current) {
        userCancelledRef.current = false;
        setStatus(accumulated.length > 0 ? 'ready' : 'idle-manual');
        return;
      }

      if (accumulated.length === 0) {
        setError(failed.length > 0 ? 'Could not analyze this video — please try again.' : 'No concepts found');
        setStatus('error');
        return;
      }

      setStatus('ready');
      // Cache only when the full run completed without failures.
      if (failed.length === 0 && launchedCount === windows.length) {
        setCachedConcepts(
          videoId,
          prefs.explainInLang,
          difficulty,
          model,
          extraCtx,
          firstDomain,
          accumulated,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, segments, videoId, prefs?.explainInLang, prefs?.difficulty, prefs?.geminiModel, prefs?.additionalContext]);

  // Manual retry of a single failed chunk. Re-runs that window (3x retry),
  // then merges its concepts into the accumulated list with id-based dedup.
  const retryWindow = useCallback(
    async (w: { startSec: number; endSec: number }) => {
      if (!prefs || !surfaceRunCtxRef.current) return;
      const ctx = surfaceRunCtxRef.current;
      if (ctx.videoId !== videoId) return;
      const meta = readVideoMeta();
      // Pass concepts already in the UI as prior-dedup signal.
      const priorConcepts = concepts.map((c) => ({ label: c.label, t: c.t }));
      const req: SurfaceParams = {
        segments,
        explainInLang: ctx.lang,
        difficulty: ctx.difficulty,
        model: ctx.model,
        additionalContext: ctx.extraCtx,
        videoTitle: meta.title,
        videoDescription: meta.description,
        focusWindow: w,
        priorConcepts,
        maxConcepts: 6,
        thinkingLevel: prefs.thinkingLevel,
      };
      setFailedWindows((prev) =>
        prev.filter((x) => x.startSec !== w.startSec || x.endSec !== w.endSec),
      );
      if (!prefs.geminiApiKey) return;
      const resp = await runWithRetry(req, prefs.geminiApiKey, 3);
      if (!resp.ok) {
        setFailedWindows((prev) =>
          prev.some((x) => x.startSec === w.startSec && x.endSec === w.endSec)
            ? prev
            : [...prev, w],
        );
        return;
      }
      chunkResultsRef.current.set(w.startSec, {
        concepts: resp.data.concepts,
        domain: resp.data.domain,
      });
      setConcepts((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        for (const c of resp.data.concepts) if (!byId.has(c.id)) byId.set(c.id, c);
        const next = Array.from(byId.values()).sort((a, b) => a.t - b.t);
        setFailedWindows((prevFailed) => {
          if (prevFailed.length === 0) {
            setCachedConcepts(
              videoId,
              ctx.lang,
              ctx.difficulty,
              ctx.model,
              ctx.extraCtx,
              domain ?? '',
              next,
            );
          }
          return prevFailed;
        });
        return next;
      });
    },
    [videoId, segments, prefs, concepts, domain],
  );

  // Summary + key moments (optional). Fires once transcript is loaded and
  // the pref is on. Cached per (video, lang, model, context).
  useEffect(() => {
    if (!prefs?.keyMomentsEnabled) {
      // Pref turned off — clear any stale state so it doesn't linger.
      setSummary('');
      setKeyMoments([]);
      setSummaryLoading(false);
      setSummaryError(null);
      return;
    }
    if (!prefs.geminiApiKey || segments.length === 0) return;

    let cancelled = false;
    (async () => {
      const lang = prefs.explainInLang;
      const model = prefs.geminiModel;
      const extraCtx = prefs.additionalContext;
      const cached = await getCachedSummary(videoId, lang, model, extraCtx);
      if (cancelled) return;
      if (cached) {
        setSummary(cached.summary);
        setKeyMoments(cached.keyMoments);
        setSummaryLoading(false);
        setSummaryError(null);
        return;
      }

      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const meta = readVideoMeta();
        const transcript = segments
          .map((s) => `[${Math.floor(s.start)}] ${s.text}`)
          .join('\n');
        const res = await generateVideoSummary({
          apiKey: prefs.geminiApiKey!,
          model,
          transcript,
          videoTitle: meta.title,
          explainInLang: lang,
          additionalContext: extraCtx,
          thinkingLevel: prefs.thinkingLevel,
        });
        if (cancelled) return;
        setSummary(res.summary);
        setKeyMoments(res.keyMoments);
        setSummaryLoading(false);
        setCachedSummary(videoId, lang, model, extraCtx, res.summary, res.keyMoments);
      } catch (e: any) {
        if (cancelled) return;
        setSummaryError(String(e?.message ?? e));
        setSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    videoId,
    segments,
    prefs?.keyMomentsEnabled,
    prefs?.geminiApiKey,
    prefs?.geminiModel,
    prefs?.explainInLang,
    prefs?.additionalContext,
  ]);

  // Esc returns from detail view.
  useEffect(() => {
    if (!detailId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailId]);

  // Poll video time via rAF — fully local, zero chrome.runtime traffic.
  useEffect(() => {
    let raf = 0;
    let lastT = -1;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      // If the extension context has gone away (dev reload), stop cleanly.
      // This prevents orphaned content scripts from spamming errors forever.
      try {
        if (!chrome.runtime?.id) {
          stopped = true;
          return;
        }
      } catch {
        stopped = true;
        return;
      }
      const v = getVideo();
      if (v && !isNaN(v.currentTime) && v.currentTime !== lastT) {
        lastT = v.currentTime;
        setCurrentT(v.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const activeConceptId = useMemo(() => findActiveConcept(concepts, currentT), [concepts, currentT]);

  // Transcript translation paused — intentionally not running.
  // The lib-level code (translateSegments, cache, SW handler) is kept so
  // flipping this back on is a small change.

  // Notes — load on mount + when video changes; subscribe to storage changes.
  useEffect(() => {
    let cancelled = false;
    listNotes(videoId).then((n) => {
      if (!cancelled) setNotes(n);
    });
    const off = onNotesChanged(() => {
      listNotes(videoId).then((n) => !cancelled && setNotes(n));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [videoId]);

  const saveNote = useCallback(
    async (
      t: number,
      text: string,
      segmentText?: string,
      link?: { conceptId?: string; conceptLabel?: string },
    ): Promise<Note> => {
      const note = await addNote(videoId, t, text, segmentText, link);
      const n = await listNotes(videoId);
      setNotes(n);
      return note;
    },
    [videoId],
  );

  const saveConceptToNotes = useCallback(
    async (c: Concept) => {
      await saveNote(c.t, c.description ?? '', undefined, {
        conceptId: c.id,
        conceptLabel: c.label,
      });
      setActiveTab('notes');
    },
    [saveNote],
  );

  // Apply focus mode to the page whenever the preference changes.
  useEffect(() => {
    setFocusMode(!!prefs?.focusMode);
  }, [prefs?.focusMode]);

  // Push state to liveStore so the fullscreen overlay can read it.
  useEffect(() => { liveStore.setConcepts(concepts); }, [concepts]);
  useEffect(() => { liveStore.setSegments(segments); }, [segments]);
  useEffect(() => { liveStore.setCurrent(currentT, activeConceptId); }, [currentT, activeConceptId]);
  useEffect(() => {
    // Map App.Status → liveStore.AppStatus. 'loading-prefs' is transient and
    // reads as 'booting' to the overlay.
    liveStore.setAppStatus(status === 'loading-prefs' ? 'booting' : status);
  }, [status]);

  // Push summary + key-moments state to the shared store so the description-
  // area mount (rendered into YouTube's DOM, outside our panel's shadow
  // tree) can read it without prop drilling across Preact roots.
  useEffect(() => {
    liveStore.setSummary({
      summary,
      keyMoments,
      summaryLoading,
      summaryError,
      summaryEnabled: !!prefs?.keyMomentsEnabled,
    });
  }, [summary, keyMoments, summaryLoading, summaryError, prefs?.keyMomentsEnabled]);

  // Inject markers on YouTube's progress bar for each concept.
  useEffect(() => {
    if (concepts.length === 0) {
      removeProgressMarkers();
      return;
    }
    updateProgressMarkers(concepts, seek);
    // YouTube sometimes re-creates the progress bar on theater/fullscreen
    // toggles or quality changes. Re-apply on those events.
    const handler = () => updateProgressMarkers(concepts, seek);
    window.addEventListener('yt-navigate-finished', handler);
    window.addEventListener('resize', handler);
    document.addEventListener('fullscreenchange', handler);
    const flexy = document.querySelector('ytd-watch-flexy');
    const obs = flexy
      ? new MutationObserver(handler)
      : null;
    obs?.observe(flexy!, { attributes: true, attributeFilter: ['theater', 'fullscreen'] });
    return () => {
      window.removeEventListener('yt-navigate-finished', handler);
      window.removeEventListener('resize', handler);
      document.removeEventListener('fullscreenchange', handler);
      obs?.disconnect();
      removeProgressMarkers();
    };
  }, [concepts]);

  // Seek pattern: set currentTime + resume playback.
  const seek = (t: number) => {
    const v = getVideo();
    if (!v) return;
    v.currentTime = t;
    if (v.paused) v.play().catch(() => {});
  };

  const regenerate = useCallback(() => {
    if (!prefs?.geminiApiKey || segments.length === 0) return;
    forceRegen.current = true;
    chunkResultsRef.current = new Map();
    setFailedWindows([]);
    setConcepts([]);
    setDomain(null);
    setError(null);
    setStatus('surfacing');
  }, [prefs?.geminiApiKey, segments.length]);

  const generateNow = useCallback(() => {
    if (!prefs?.geminiApiKey || segments.length === 0) return;
    setError(null);
    setStatus('surfacing');
  }, [prefs?.geminiApiKey, segments.length]);

  const cancelSurfacing = useCallback(() => {
    userCancelledRef.current = true;
    setStopping(true);
  }, []);

  if (status === 'loading-prefs' || !prefs) {
    return <Shell><Center muted>Loading…</Center></Shell>;
  }

  if (status === 'need-key') {
    return (
      <Shell>
        <OnboardKey
          onSave={async (patch) => {
            const p = await setPrefs(patch);
            setPrefsState(p);
            setStatus('loading-transcript');
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Header
        domain={domain}
        filter={filter}
        onFilter={setFilter}
        onSettings={() => setSettingsOpen(true)}
        onRegenerate={regenerate}
        regenerating={status === 'surfacing' || status === 'loading-transcript'}
        canRegenerate={status === 'ready' || status === 'error'}
        focusMode={!!prefs.focusMode}
        onToggleFocus={() => setPrefs({ focusMode: !prefs.focusMode })}
      />
      {status === 'loading-transcript' && (
        <>
          <GeneratingBanner phase="transcript" progress={null} />
          <SkeletonCards />
        </>
      )}
      {status === 'surfacing' && concepts.length === 0 && (
        <>
          <GeneratingBanner
            phase="surfacing"
            progress={surfaceProgress}
            onCancel={cancelSurfacing}
            stopping={stopping}
          />
          <SkeletonCards />
        </>
      )}
      {(status === 'idle-manual' ||
        status === 'no-transcript' ||
        status === 'error') && (
        <PreGenerationView
          status={status}
          error={error}
          onGenerate={generateNow}
          canGenerate={segments.length > 0}
        />
      )}
      {(status === 'ready' || (status === 'surfacing' && concepts.length > 0)) && (
        detailId ? (
          <ConceptDetail
            videoId={videoId}
            concept={concepts.find((c) => c.id === detailId) ?? concepts[0]}
            segments={segments}
            allConcepts={concepts}
            prefs={prefs}
            onBack={() => setDetailId(null)}
            onSeek={seek}
            onNavigate={(id) => setDetailId(id)}
          />
        ) : (
          <>
            {status === 'surfacing' && surfaceProgress && (
              <GeneratingBanner
                phase="surfacing"
                progress={surfaceProgress}
                onCancel={cancelSurfacing}
              />
            )}
            <CaptionStrip
              segments={segments}
              currentT={currentT}
              onSeek={seek}
              sourceLang={transcriptLang}
              targetLang={prefs.explainInLang}
              translatedTexts={translatedTexts}
              translating={translating}
            />
            <Tabs
              active={activeTab}
              onChange={setActiveTab}
              conceptCount={concepts.length}
              notesCount={notes.length}
            />
            {activeTab === 'concepts' ? (
              <>
                <Timeline
                  concepts={concepts}
                  currentT={currentT}
                  durationSec={getVideo()?.duration ?? 0}
                  activeId={activeConceptId}
                  onSeek={seek}
                  failedWindows={failedWindows}
                  onRetryWindow={retryWindow}
                  processedWindows={processedWindows}
                  inProgress={status === 'surfacing'}
                />
                <ConceptsList
                  concepts={concepts}
                  activeId={activeConceptId}
                  currentT={currentT}
                  filter={filter}
                  videoId={videoId}
                  onSeek={seek}
                  onOpenDetail={(c) => setDetailId(c.id)}
                  onSaveToNotes={saveConceptToNotes}
                />
              </>
            ) : (
              <NotesList
                videoId={videoId}
                notes={notes}
                currentT={currentT}
                onSeek={seek}
                onNewNote={async () => {
                  await saveNote(currentT, '');
                }}
              />
            )}
          </>
        )
      )}
      {settingsOpen && (
        <Settings
          prefs={prefs}
          onClose={() => setSettingsOpen(false)}
          onChange={async (patch) => {
            const p = await setPrefs(patch);
            setPrefsState(p);
          }}
        />
      )}
    </Shell>
  );
}

async function runWithRetry(
  params: SurfaceParams,
  apiKey: string,
  maxAttempts: number,
  isCancelled?: () => boolean,
  onRateLimit?: () => void,
): Promise<CallResult<SurfaceResult>> {
  let lastErr = 'Unknown error';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isCancelled?.()) return { ok: false, error: 'Cancelled' };
    try {
      const data = await surfaceConcepts({ apiKey, ...params });
      return { ok: true, data };
    } catch (e: any) {
      lastErr = String(e?.message ?? e);
    }
    const isRateLimit = /\b(429|rate limit|quota|resource_exhausted)\b/i.test(lastErr);
    // Signal a pipeline-wide cooldown so sibling workers don't keep firing
    // into the same 429 wall. Fires on the first rate-limit hit, not just
    // the last attempt, because sibling launches happen between attempts.
    if (isRateLimit) onRateLimit?.();
    if (attempt < maxAttempts - 1) {
      // Exponential backoff with extra wait for rate-limit errors, since the
      // server is asking us to slow down. 1s, 2s, 4s… plus a rate-limit
      // surcharge (15s — long enough for a 60s-bucket refill to have room).
      // Split the sleep into 100ms polls so user-cancel takes effect
      // mid-wait instead of after several seconds.
      const base = 1000 * Math.pow(2, attempt);
      const delay = isRateLimit ? base + 15000 : base;
      const deadline = Date.now() + delay;
      while (Date.now() < deadline) {
        if (isCancelled?.()) return { ok: false, error: 'Cancelled' };
        await new Promise((r) => setTimeout(r, Math.min(100, deadline - Date.now())));
      }
    }
  }
  return { ok: false, error: lastErr };
}


function Shell({ children }: { children: preact.ComponentChildren }) {
  return <div className="flex flex-col h-full bg-[var(--color-bg)] text-[var(--color-fg)]">{children}</div>;
}

function Center({ children, muted }: { children: preact.ComponentChildren; muted?: boolean }) {
  return (
    <div className={`flex-1 flex items-center justify-center px-6 text-center text-[12.5px] ${muted ? 'text-[var(--color-fg-muted)]' : ''}`}>
      {children}
    </div>
  );
}

/**
 * Empty / error / no-transcript state. Shown before generation starts,
 * after a failed run, or when the video has no captions. Explains what the
 * app does, offers a primary Generate action (unless we know it won't help,
 * e.g. no transcript), and lists common reasons something might have gone
 * wrong.
 */
function PreGenerationView({
  status,
  error,
  onGenerate,
  canGenerate,
}: {
  status: 'idle-manual' | 'no-transcript' | 'error';
  error: string | null;
  onGenerate: () => void;
  canGenerate: boolean;
}) {
  const title =
    status === 'idle-manual'
      ? 'Nothing to gloss yet.'
      : status === 'no-transcript'
      ? "Can't read this video."
      : 'Something went wrong.';

  const description =
    status === 'idle-manual'
      ? 'Gloss pulls a transcript from this video, then asks Gemini to surface concepts, jargon, people, places and tools worth knowing. Takes about a minute for short clips, longer for full-length talks.'
      : status === 'no-transcript'
      ? "Gloss needs captions to work. This video doesn't expose any — YouTube may not have auto-generated them yet, or the creator has them disabled."
      : error ||
        'The last run ended early. Try again — it usually works on the second attempt.';

  const showGenerate = status !== 'no-transcript' && canGenerate;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-5 pt-6 pb-4">
        <GlossLogo size={64} />
        <h2
          className="mt-5 text-[var(--color-fg)]"
          style={{
            fontFamily: '"Source Serif 4", Georgia, serif',
            fontSize: 24,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}
        >
          {title}
        </h2>
        <p
          className="mt-2.5 text-[var(--color-fg-muted)]"
          style={{ fontSize: 13, lineHeight: 1.55 }}
        >
          {description}
        </p>
        {showGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            className="mt-4 inline-flex items-center gap-1.5 transition-opacity hover:opacity-90"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
              fontSize: 13,
              fontWeight: 600,
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {status === 'error' ? 'Try again' : 'Generate gloss'}
          </button>
        )}
      </div>

      <div className="mx-5 border-t border-[var(--color-border-subtle)]" />

      <div className="px-5 pt-4 pb-6">
        <div
          className="mb-2.5 uppercase font-semibold text-[var(--color-fg-subtle)]"
          style={{ fontSize: 10.5, letterSpacing: '0.14em' }}
        >
          Common reasons
        </div>
        <div className="space-y-2">
          <ReasonCard
            title="No captions available"
            body="Gloss needs a transcript. Turn on auto-captions in YouTube, or use a video that has them."
          />
          <ReasonCard
            title="Age-restricted or private"
            body="YouTube blocks transcript access for some videos."
          />
          <ReasonCard
            title="Auto-generate is off"
            body="Flip it on in Settings, or press Generate above."
          />
        </div>
      </div>
    </div>
  );
}

function ReasonCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        className="text-[var(--color-fg)]"
        style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}
      >
        {title}
      </div>
      <div
        className="text-[var(--color-fg-muted)]"
        style={{ fontSize: 11.5, lineHeight: 1.5 }}
      >
        {body}
      </div>
    </div>
  );
}


/**
 * Compact branded banner shown during the transcript-fetch and concept-
 * surfacing phases. Sits at the top of the panel so concepts can stream in
 * beneath it; also doubles as the empty-state banner when no concept has
 * landed yet (paired with SkeletonCards below).
 */
function GeneratingBanner({
  phase,
  progress,
  onCancel,
  stopping,
}: {
  phase: 'transcript' | 'surfacing';
  progress: { done: number; total: number } | null;
  onCancel?: () => void;
  stopping?: boolean;
}) {
  const hue = 275; // matches --accent
  const isChunked = phase === 'surfacing' && progress !== null && progress.total > 1;
  const pct =
    isChunked && progress
      ? Math.round(((progress.done + 0.5) / progress.total) * 100)
      : null;
  const eyebrow = stopping
    ? 'Stopping…'
    : phase === 'transcript'
    ? 'Reading transcript'
    : 'Generating gloss';

  return (
    <div className="flex-none px-3 pt-2">
      <div
        className="relative overflow-hidden"
        style={{
          padding: '10px 12px 11px',
          borderRadius: 10,
          background: `linear-gradient(135deg, oklch(16% 0.05 ${hue}) 0%, oklch(10% 0.02 ${hue}) 100%)`,
          border: `1px solid oklch(28% 0.08 ${hue})`,
        }}
      >
        {/* Sweeping shimmer across the card. */}
        <div
          className="pointer-events-none absolute inset-0 anim-gloss-shimmer"
          style={{
            background: `linear-gradient(90deg, transparent 0%, oklch(75% 0.12 ${hue} / 0.08) 50%, transparent 100%)`,
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <SpinningOrb hue={hue} size={18} />
          <div
            className="font-bold uppercase flex-1 min-w-0 truncate"
            style={{
              fontSize: 9.5,
              letterSpacing: '0.18em',
              color: `oklch(80% 0.14 ${hue})`,
            }}
          >
            {eyebrow}
          </div>
          {pct !== null ? (
            <div
              className="tabular-nums"
              style={{
                fontSize: 20,
                fontWeight: 500,
                color: '#f5f2ff',
                fontFamily: '"Source Serif 4", Georgia, serif',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {pct}
              <span style={{ fontSize: 12, color: '#8b87a3', marginLeft: 1 }}>%</span>
            </div>
          ) : null}
          {onCancel && phase === 'surfacing' && (
            <button
              type="button"
              onClick={onCancel}
              disabled={stopping}
              title={stopping ? 'Stopping…' : 'Stop finding more concepts'}
              className="flex-none inline-flex items-center transition-colors"
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                height: 20,
                padding: '0 8px',
                borderRadius: 999,
                color: stopping ? '#8b87a3' : '#c9c5dd',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                cursor: stopping ? 'default' : 'pointer',
                opacity: stopping ? 0.6 : 1,
              }}
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
        </div>

        <div
          className="relative overflow-hidden"
          style={{
            marginTop: 8,
            height: 3,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.06)',
          }}
        >
          {pct !== null ? (
            <div
              className="absolute left-0 top-0 bottom-0"
              style={{
                width: `${Math.max(2, pct)}%`,
                background: `linear-gradient(90deg, oklch(55% 0.2 ${hue}), oklch(72% 0.18 ${hue}))`,
                borderRadius: 2,
                transition: 'width 500ms ease',
              }}
            />
          ) : (
            <div
              className="absolute top-0 bottom-0 anim-slide"
              style={{
                width: '35%',
                background: `linear-gradient(90deg, transparent, oklch(72% 0.18 ${hue}), transparent)`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="flex-1 overflow-hidden px-2 pt-2 space-y-2">
      {[92, 78, 86, 70, 80, 64].map((w, i) => (
        <div
          key={i}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 space-y-2"
          style={{ opacity: 1 - i * 0.08 }}
        >
          <div className="flex gap-2 items-center">
            <div className="h-3 w-14 rounded shimmer" />
            <div className="h-3 w-10 rounded shimmer ml-auto" />
          </div>
          <div className="h-3.5 rounded shimmer" style={{ width: w + '%' }} />
          <div className="h-2.5 rounded shimmer" style={{ width: Math.max(30, w - 20) + '%' }} />
        </div>
      ))}
    </div>
  );
}

function SpinningOrb({ hue, size = 28 }: { hue: number; size?: number }) {
  const inset = Math.max(2, Math.round(size / 9));
  return (
    <div
      className="relative flex-none anim-gloss-spin"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `conic-gradient(from 0deg, oklch(80% 0.2 ${hue}), oklch(30% 0.08 ${hue}) 40%, oklch(30% 0.08 ${hue}))`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, oklch(85% 0.2 ${hue}), oklch(18% 0.06 ${hue}))`,
          boxShadow: `0 0 ${Math.round(size * 0.4)}px oklch(70% 0.2 ${hue} / 0.4)`,
        }}
      />
    </div>
  );
}

function findActiveConcept(concepts: Concept[], t: number): string | null {
  // A concept stays active from its timestamp until the NEXT concept's
  // timestamp — i.e., the most recent concept whose t <= current time.
  // Concepts are sorted by t, so binary-search for the last one.
  if (concepts.length === 0) return null;
  let lo = 0;
  let hi = concepts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (concepts[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? concepts[ans].id : null;
}
