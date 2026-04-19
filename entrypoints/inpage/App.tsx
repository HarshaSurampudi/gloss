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
import { surfaceConcepts } from '@/lib/gemini';
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
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [surfaceProgress, setSurfaceProgress] = useState<{ done: number; total: number } | null>(null);
  const [failedWindows, setFailedWindows] = useState<Array<{ startSec: number; endSec: number }>>([]);
  const [processedWindows, setProcessedWindows] = useState<Array<{ startSec: number; endSec: number }>>([]);
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
        };
        const resp = await runWithRetry(req, prefs.geminiApiKey!, 3);
        if (cancelled) return;
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
      const CONCURRENCY = 3;
      const LAUNCH_SPACING_MS = 300;
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
        if (cancelled) return;
        if (userCancelledRef.current) break;
        // Throttle launches to stay under RPM and to avoid bursting.
        if (i > 0) await new Promise((r) => setTimeout(r, LAUNCH_SPACING_MS));
        if (cancelled) return;
        if (userCancelledRef.current) break;
        // If at concurrency cap, wait for any in-flight to settle.
        if (inflight.size >= CONCURRENCY) {
          await Promise.race(inflight);
          if (cancelled) return;
          if (userCancelledRef.current) break;
        }
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
        };
        const p = (async () => {
          const resp = await runWithRetry(req, prefs.geminiApiKey!, 3);
          if (cancelled) return;
          pending.set(idx, { window: w, resp });
          commitReady();
        })();
        inflight.add(p);
        p.finally(() => inflight.delete(p));
      }
      // Drain. (Even on user-cancel we wait for in-flight to settle so their
      // commits land; no new launches happen.)
      while (inflight.size > 0 && !cancelled) {
        await Promise.race(inflight);
      }
      if (cancelled) return;
      setSurfaceProgress(null);

      const wasCancelled = userCancelledRef.current;
      userCancelledRef.current = false;

      if (accumulated.length === 0) {
        if (wasCancelled) {
          // User stopped before anything landed — drop back to manual idle.
          setStatus('idle-manual');
          return;
        }
        setError(failed.length > 0 ? 'Could not analyze this video — please try again.' : 'No concepts found');
        setStatus('error');
        return;
      }

      setStatus('ready');
      // Cache only when the full run completed without failures or a user
      // cancel — partial results would be confusingly incomplete on a future
      // cache hit.
      if (!wasCancelled && failed.length === 0 && launchedCount === windows.length) {
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
    async (t: number, text: string, segmentText?: string): Promise<Note> => {
      const note = await addNote(videoId, t, text, segmentText);
      const n = await listNotes(videoId);
      setNotes(n);
      return note;
    },
    [videoId],
  );

  const saveConceptToNotes = useCallback(
    async (c: Concept) => {
      const body = c.description ? `${c.label}\n\n${c.description}` : c.label;
      await saveNote(c.t, body);
      setNotesOpen(true);
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
  }, []);

  if (status === 'loading-prefs' || !prefs) {
    return <Shell><Center muted>Loading…</Center></Shell>;
  }

  if (status === 'need-key') {
    return (
      <Shell>
        <OnboardKey
          onSave={async (key) => {
            const p = await setPrefs({ geminiApiKey: key });
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
        conceptCount={concepts.length}
        notesCount={notes.length}
        filter={filter}
        onFilter={setFilter}
        onSettings={() => setSettingsOpen(true)}
        onRegenerate={regenerate}
        regenerating={status === 'surfacing' || status === 'loading-transcript'}
        canRegenerate={status === 'ready' || status === 'error'}
        focusMode={!!prefs.focusMode}
        onToggleFocus={() => setPrefs({ focusMode: !prefs.focusMode })}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((v) => !v)}
      />
      {status === 'loading-transcript' && <LoadingBody phase="transcript" progress={null} />}
      {status === 'surfacing' && concepts.length === 0 && (
        <LoadingBody phase="surfacing" progress={surfaceProgress} onCancel={cancelSurfacing} />
      )}
      {status === 'idle-manual' && (
        <IdleManual
          onGenerate={generateNow}
          segments={segments}
          currentT={currentT}
          onSeek={seek}
        />
      )}
      {status === 'no-transcript' && <Center muted>No transcript available for this video.</Center>}
      {status === 'error' && <ErrorBody message={error ?? 'Something went wrong.'} />}
      {(status === 'ready' || (status === 'surfacing' && concepts.length > 0)) && (
        detailId ? (
          <ConceptDetail
            videoId={videoId}
            concept={concepts.find((c) => c.id === detailId) ?? concepts[0]}
            segments={segments}
            prefs={prefs}
            onBack={() => setDetailId(null)}
            onSeek={seek}
          />
        ) : notesOpen ? (
          <NotesList
            videoId={videoId}
            notes={notes}
            currentT={currentT}
            onSeek={seek}
            onNewNote={async () => {
              await saveNote(currentT, '');
            }}
            onBack={() => setNotesOpen(false)}
          />
        ) : (
          <>
            {status === 'surfacing' && surfaceProgress && (
              <SurfacingBanner progress={surfaceProgress} onCancel={cancelSurfacing} />
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
): Promise<CallResult<SurfaceResult>> {
  let lastErr = 'Unknown error';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const data = await surfaceConcepts({ apiKey, ...params });
      return { ok: true, data };
    } catch (e: any) {
      lastErr = String(e?.message ?? e);
    }
    if (attempt < maxAttempts - 1) {
      // Exponential backoff with extra wait for rate-limit errors, since the
      // server is asking us to slow down. 1s, 2s, 4s… plus a rate-limit
      // surcharge.
      const isRateLimit = /\b(429|rate limit|quota|resource_exhausted)\b/i.test(lastErr);
      const base = 1000 * Math.pow(2, attempt);
      const delay = isRateLimit ? base + 4000 : base;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return { ok: false, error: lastErr };
}

function SurfacingBanner({
  progress,
  onCancel,
}: {
  progress: { done: number; total: number };
  onCancel?: () => void;
}) {
  const pct = (progress.done / Math.max(1, progress.total)) * 100;
  return (
    <div className="flex-none px-3 pt-2">
      <div
        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px]"
        style={{
          background: 'color-mix(in oklab, var(--color-accent) 8%, transparent)',
          border: '1px solid color-mix(in oklab, var(--color-accent) 25%, transparent)',
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full anim-breathe flex-none"
          style={{ background: 'var(--color-accent)' }}
        />
        <span className="text-[var(--color-fg)] font-medium">
          Finding concepts
        </span>
        <span className="text-[var(--color-fg-muted)] tabular-nums">
          {Math.round((progress.done / Math.max(1, progress.total)) * 100)}%
        </span>
        <div
          className="ml-auto h-1 flex-1 max-w-[100px] rounded-full overflow-hidden"
          style={{ background: 'var(--color-border-subtle)' }}
        >
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.max(4, pct)}%`,
              background: 'var(--color-accent)',
            }}
          />
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            title="Stop finding more concepts"
            className="flex-none inline-flex items-center h-[20px] px-2 rounded-md text-[10.5px] font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
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

function IdleManual({
  onGenerate,
  segments,
  currentT,
  onSeek,
}: {
  onGenerate: () => void;
  segments: TranscriptSegment[];
  currentT: number;
  onSeek: (t: number) => void;
}) {
  return (
    <>
      <CaptionStrip segments={segments} currentT={currentT} onSeek={onSeek} />
      <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
        <div
          className="w-12 h-12 rounded-xl inline-flex items-center justify-center mb-3"
          style={{
            background: 'color-mix(in oklab, var(--color-accent) 12%, transparent)',
            color: 'var(--color-accent)',
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="text-[14px] font-semibold text-[var(--color-fg)] mb-1">
          Ready when you are
        </div>
        <div className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed max-w-[260px] mb-4">
          Auto-generate is off. Click to identify and explain concepts in this video.
        </div>
        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[12.5px] font-semibold"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
          </svg>
          Generate concepts
        </button>
        <div className="mt-3 text-[10.5px] text-[var(--color-fg-subtle)]">
          Change this default in Settings.
        </div>
      </div>
    </>
  );
}

function LoadingBody({
  phase,
  progress,
  onCancel,
}: {
  phase: 'transcript' | 'surfacing';
  progress: { done: number; total: number } | null;
  onCancel?: () => void;
}) {
  const isChunked = phase === 'surfacing' && progress !== null && progress.total > 1;
  const pct = progress ? (progress.done / Math.max(1, progress.total)) * 100 : null;

  const label =
    phase === 'transcript'
      ? 'Reading transcript'
      : isChunked
      ? `Finding concepts · ${Math.round(pct!)}%`
      : 'Finding concepts';

  const helper =
    phase === 'transcript'
      ? 'Pulling captions from YouTube.'
      : isChunked
      ? 'Longer videos take a bit — concepts will start appearing shortly.'
      : 'Analyzing the video. Usually 10–20 seconds — feel free to start watching.';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-none px-3 pt-3 pb-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full anim-breathe"
            style={{ background: 'var(--color-accent)' }}
          />
          <div className="text-[12px] font-semibold text-[var(--color-fg)] flex-1 truncate">
            {label}
          </div>
          {pct !== null && isChunked && (
            <div className="text-[10.5px] font-mono tabular-nums text-[var(--color-fg-subtle)]">
              {Math.round(pct)}%
            </div>
          )}
          {phase === 'surfacing' && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              title="Stop finding more concepts"
              className="flex-none inline-flex items-center h-[20px] px-2 rounded-md text-[10.5px] font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Stop
            </button>
          )}
        </div>
        <div className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed mb-2">
          {helper}
        </div>
        {/* Determinate bar when we know the total; otherwise an indeterminate shimmer. */}
        <div
          className="h-1 rounded-full overflow-hidden"
          style={{ background: 'var(--color-border-subtle)' }}
        >
          {pct !== null ? (
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${Math.max(4, pct)}%`,
                background: 'var(--color-accent)',
              }}
            />
          ) : (
            <div
              className="h-full anim-slide"
              style={{
                width: '35%',
                background:
                  'linear-gradient(90deg, transparent, var(--color-accent), transparent)',
              }}
            />
          )}
        </div>
      </div>
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
    </div>
  );
}

function ErrorBody({ message }: { message: string }) {
  return (
    <div className="flex-1 p-4 flex flex-col items-center justify-center text-center">
      <div className="text-[13px] font-semibold text-[var(--color-danger)] mb-1">Something went wrong</div>
      <div className="text-[12px] text-[var(--color-fg-muted)] max-w-[280px] leading-relaxed">{message}</div>
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
