import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  BgResponse,
  Concept,
  Preferences,
  SurfaceRequest,
  SurfaceResult,
  TranscriptSegment,
  TranslateRequest,
} from '@/lib/types';
import { getPrefs, onPrefsChanged, setPrefs } from '@/lib/storage';
import { fetchTranscript } from '@/lib/transcript';
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
  const [viewMode, setViewMode] = useState<'concepts' | 'notes'>('concepts');
  const [notes, setNotes] = useState<Note[]>([]);
  const forceRegen = useRef(false);

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
  useEffect(() => {
    if (status !== 'surfacing' || !prefs) return;
    const difficulty = prefs.difficulty === 'auto' ? 'intermediate' : prefs.difficulty;
    const model = prefs.geminiModel;
    const extraCtx = prefs.additionalContext;
    let cancelled = false;
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
      const req: SurfaceRequest = {
        type: 'surface',
        segments,
        explainInLang: prefs.explainInLang,
        difficulty,
        model,
        additionalContext: extraCtx,
        videoTitle: meta.title,
        videoDescription: meta.description,
      };
      try {
        if (!chrome.runtime?.id) throw new Error('Extension context invalidated — reload this tab.');
        chrome.runtime.sendMessage(req, (resp: BgResponse<SurfaceResult>) => {
          if (cancelled) return;
          if (chrome.runtime.lastError) {
            setError(chrome.runtime.lastError.message || 'Extension error');
            setStatus('error');
            return;
          }
          if (!resp?.ok) {
            setError(resp?.error || 'Gemini call failed');
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
        });
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, segments, videoId, prefs?.explainInLang, prefs?.difficulty, prefs?.geminiModel, prefs?.additionalContext]);

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

  // Kick off transcript translation when the user has opted in and the
  // transcript's language differs from the explain-in language.
  useEffect(() => {
    if (!prefs || !prefs.translateTranscript) {
      setTranslatedTexts(null);
      return;
    }
    if (!transcriptLang || segments.length === 0) return;
    const src = transcriptLang.split('-')[0];
    const tgt = prefs.explainInLang.split('-')[0];
    if (src === tgt) {
      setTranslatedTexts(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setTranslatedTexts(null);
      const cached = await getCachedTranslation(videoId, prefs.explainInLang);
      if (cancelled) return;
      if (cached && cached.length === segments.length) {
        setTranslatedTexts(cached);
        return;
      }
      const req: TranslateRequest = {
        type: 'translate',
        segments,
        sourceLang: src,
        targetLang: prefs.explainInLang,
        model: prefs.geminiModel,
      };
      try {
        if (!chrome.runtime?.id) return;
        setTranslating(true);
        chrome.runtime.sendMessage(req, (resp: BgResponse<string[]>) => {
          setTranslating(false);
          if (cancelled) return;
          if (chrome.runtime.lastError) return;
          if (!resp?.ok) return;
          setTranslatedTexts(resp.data);
          setCachedTranslation(videoId, prefs.explainInLang, resp.data);
        });
      } catch {
        setTranslating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    prefs?.translateTranscript,
    prefs?.explainInLang,
    prefs?.geminiModel,
    transcriptLang,
    segments,
    videoId,
  ]);

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
    async (t: number, text: string, segmentText?: string) => {
      await addNote(videoId, t, text, segmentText);
      const n = await listNotes(videoId);
      setNotes(n);
    },
    [videoId],
  );

  // Apply focus mode to the page whenever the preference changes.
  useEffect(() => {
    setFocusMode(!!prefs?.focusMode);
  }, [prefs?.focusMode]);

  // Push state to liveStore so the fullscreen overlay can read it.
  useEffect(() => { liveStore.setConcepts(concepts); }, [concepts]);
  useEffect(() => { liveStore.setSegments(segments); }, [segments]);
  useEffect(() => { liveStore.setCurrent(currentT, activeConceptId); }, [currentT, activeConceptId]);

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
        filter={filter}
        onFilter={setFilter}
        onSettings={() => setSettingsOpen(true)}
        onRegenerate={regenerate}
        regenerating={status === 'surfacing' || status === 'loading-transcript'}
        canRegenerate={status === 'ready' || status === 'error'}
      />
      {(status === 'loading-transcript' || status === 'surfacing') && (
        <LoadingBody
          label={status === 'loading-transcript' ? 'Reading transcript…' : 'Finding concepts…'}
          helper={
            status === 'surfacing'
              ? 'Analyzing the whole video. Usually takes 10–20 seconds — feel free to start watching.'
              : 'Fetching captions from YouTube.'
          }
        />
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
      {status === 'ready' && (
        detailId ? (
          <ConceptDetail
            videoId={videoId}
            concept={concepts.find((c) => c.id === detailId) ?? concepts[0]}
            segments={segments}
            prefs={prefs}
            onBack={() => setDetailId(null)}
            onSeek={seek}
          />
        ) : (
          <>
            <CaptionStrip
              segments={segments}
              currentT={currentT}
              onSeek={seek}
              sourceLang={transcriptLang}
              targetLang={prefs.explainInLang}
              translatedTexts={translatedTexts}
              translating={translating}
              onAddNote={saveNote}
            />
            <Timeline
              concepts={concepts}
              currentT={currentT}
              durationSec={getVideo()?.duration ?? 0}
              activeId={activeConceptId}
              onSeek={seek}
            />
            <ViewSwitcher view={viewMode} onChange={setViewMode} notesCount={notes.length} conceptsCount={concepts.length} />
            {viewMode === 'concepts' ? (
              <ConceptsList
                concepts={concepts}
                activeId={activeConceptId}
                currentT={currentT}
                filter={filter}
                onSeek={seek}
                onOpenDetail={(c) => setDetailId(c.id)}
              />
            ) : (
              <NotesList videoId={videoId} notes={notes} onSeek={seek} />
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

function ViewSwitcher({
  view,
  onChange,
  notesCount,
  conceptsCount,
}: {
  view: 'concepts' | 'notes';
  onChange: (v: 'concepts' | 'notes') => void;
  notesCount: number;
  conceptsCount: number;
}) {
  return (
    <div className="flex-none px-3 pt-1.5 pb-0">
      <div
        role="tablist"
        className="inline-flex items-center h-[22px] rounded-full p-[2px] text-[10.5px] font-semibold"
        style={{
          background: 'color-mix(in oklab, var(--color-fg-subtle) 18%, transparent)',
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === 'concepts'}
          onClick={() => onChange('concepts')}
          className="inline-flex items-center gap-1 h-[18px] px-2 rounded-full transition-colors"
          style={{
            background: view === 'concepts' ? 'var(--color-bg)' : 'transparent',
            color: view === 'concepts' ? 'var(--color-fg)' : 'var(--color-fg-subtle)',
            boxShadow: view === 'concepts' ? '0 1px 2px color-mix(in oklab, var(--color-fg) 20%, transparent)' : 'none',
          }}
        >
          Concepts
          {conceptsCount > 0 && (
            <span className="font-mono text-[9.5px] opacity-70">{conceptsCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'notes'}
          onClick={() => onChange('notes')}
          className="inline-flex items-center gap-1 h-[18px] px-2 rounded-full transition-colors"
          style={{
            background: view === 'notes' ? 'var(--color-bg)' : 'transparent',
            color: view === 'notes' ? 'var(--color-fg)' : 'var(--color-fg-subtle)',
            boxShadow: view === 'notes' ? '0 1px 2px color-mix(in oklab, var(--color-fg) 20%, transparent)' : 'none',
          }}
        >
          Notes
          {notesCount > 0 && (
            <span className="font-mono text-[9.5px] opacity-70">{notesCount}</span>
          )}
        </button>
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

function LoadingBody({ label, helper }: { label: string; helper?: string }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-none px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-2 h-2 rounded-full anim-breathe"
            style={{ background: 'var(--color-accent)' }}
          />
          <div className="text-[11.5px] font-semibold text-[var(--color-fg)]">{label}</div>
        </div>
        {helper && (
          <div className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">{helper}</div>
        )}
      </div>
      <div className="flex-1 overflow-hidden px-2 space-y-2">
        {[90, 70, 82, 64, 76].map((w, i) => (
          <div key={i} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 space-y-2">
            <div className="flex gap-2 items-center">
              <div className="h-3 w-14 rounded shimmer" />
              <div className="h-3 w-10 rounded shimmer ml-auto" />
            </div>
            <div className="h-3.5 rounded shimmer" style={{ width: w + '%' }} />
            <div className="h-2.5 rounded shimmer" style={{ width: w - 20 + '%' }} />
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
  // A concept is "active" if the playhead is within the window [t-2, t+6].
  // Pick the one whose timestamp is closest to the playhead inside that window.
  let best: Concept | null = null;
  let bestDist = Infinity;
  for (const c of concepts) {
    const dist = Math.abs(c.t - t);
    if (c.t - 2 <= t && c.t + 6 >= t && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best?.id ?? null;
}
