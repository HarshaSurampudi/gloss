import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Concept, Preferences, TranscriptSegment } from '@/lib/types';
import { getCachedDetail, setCachedDetail } from '@/lib/cache';
import { readVideoMeta } from '@/lib/videoMeta';
import {
  buildDetailSystem,
  buildDetailUserContent,
  buildFollowupSystem,
  generateDeepDive,
  generateFollowupAnswer,
} from '@/lib/gemini';
import { chipColorVar, chipLabel, formatTime } from '../utils';
import { TypeIcon } from './TypeIcon';

interface ConceptDetailProps {
  videoId: string;
  concept: Concept;
  segments: TranscriptSegment[];
  allConcepts: Concept[];
  prefs: Preferences;
  onBack: () => void;
  onSeek: (t: number) => void;
  onNavigate: (conceptId: string) => void;
}

type DetailStatus = 'loading' | 'ready' | 'error';

interface QA {
  role: 'user' | 'model';
  text: string;
  /** Present on model turns — quick follow-ups the user can tap to ask next. */
  suggestions?: string[];
}

export function ConceptDetail({
  videoId,
  concept,
  segments,
  allConcepts,
  prefs,
  onBack,
  onSeek,
  onNavigate,
}: ConceptDetailProps) {
  const [detailText, setDetailText] = useState('');
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('loading');
  const [detailError, setDetailError] = useState<string | null>(null);
  /** Starter follow-up prompts from the deep-dive response. Shown once,
   *  disappear after the user sends their first question. */
  const [starterFollowups, setStarterFollowups] = useState<string[]>([]);

  const [qa, setQa] = useState<QA[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const difficulty = prefs.difficulty === 'auto' ? 'intermediate' : prefs.difficulty;

  // Prev/next (chronological).
  const { prev, next } = useMemo(() => {
    const sorted = [...allConcepts].sort((a, b) => a.t - b.t);
    const idx = sorted.findIndex((c) => c.id === concept.id);
    return {
      prev: idx > 0 ? sorted[idx - 1] : null,
      next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null,
    };
  }, [allConcepts, concept.id]);

  // Load detail: cache first, else call Gemini. Cache stores the full
  // structured response (body + followupPrompts) as JSON text.
  useEffect(() => {
    let cancelled = false;
    setDetailText('');
    setDetailStatus('loading');
    setDetailError(null);
    setStarterFollowups([]);
    setQa([]);

    (async () => {
      const cached = await getCachedDetail(
        videoId,
        concept.id,
        prefs.explainInLang,
        prefs.geminiModel,
      );
      if (cancelled) return;
      if (cached) {
        // Cached entry is a JSON string; fall back to treating it as raw
        // markdown for entries pre-dating this format.
        try {
          const parsed = JSON.parse(cached) as {
            body?: string;
            followupPrompts?: string[];
          };
          if (parsed && typeof parsed.body === 'string') {
            setDetailText(parsed.body);
            setStarterFollowups(parsed.followupPrompts ?? []);
            setDetailStatus('ready');
            return;
          }
        } catch {
          /* not JSON — treat as plain markdown */
        }
        setDetailText(cached);
        setDetailStatus('ready');
        return;
      }
      if (!prefs.geminiApiKey) {
        setDetailError('No API key set.');
        setDetailStatus('error');
        return;
      }
      const meta = readVideoMeta();
      const fullTranscript = segments
        .map((s) => `[${Math.floor(s.start)}] ${s.text}`)
        .join('\n');
      try {
        const result = await generateDeepDive({
          apiKey: prefs.geminiApiKey,
          model: prefs.geminiModel,
          system: buildDetailSystem({
            explainInLang: prefs.explainInLang,
            additionalContext: prefs.additionalContext,
          }),
          user: buildDetailUserContent({
            concept,
            videoTitle: meta.title,
            videoDescription: meta.description,
            fullTranscript,
            difficulty,
          }),
        });
        if (cancelled) return;
        setDetailText(result.body);
        setStarterFollowups(result.followupPrompts ?? []);
        setDetailStatus('ready');
        setCachedDetail(
          videoId,
          concept.id,
          prefs.explainInLang,
          prefs.geminiModel,
          JSON.stringify({
            body: result.body,
            followupPrompts: result.followupPrompts ?? [],
          }),
        );
      } catch (e: any) {
        if (cancelled) return;
        setDetailError(String(e?.message ?? e));
        setDetailStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoId, concept.id, prefs.explainInLang, prefs.geminiModel]);

  const askQuestion = async (q: string) => {
    const question = q.trim();
    if (!question || asking || detailStatus !== 'ready') return;
    if (!prefs.geminiApiKey) {
      setQaError('No API key set.');
      return;
    }
    const history = qa.slice();
    setQa([...qa, { role: 'user', text: question }]);
    setQuestion('');
    setAsking(true);
    setQaError(null);
    // Starter prompts disappear as soon as the thread kicks off — from here
    // each model turn carries its own fresh suggestions.
    setStarterFollowups([]);

    try {
      const priming = `Deep-dive context you previously wrote about this concept:\n\n${detailText}\n\n(This is background — answer the user's follow-up question below.)`;
      const result = await generateFollowupAnswer({
        apiKey: prefs.geminiApiKey,
        model: prefs.geminiModel,
        system: buildFollowupSystem({
          concept,
          explainInLang: prefs.explainInLang,
          additionalContext: prefs.additionalContext,
        }),
        history: [
          { role: 'user', parts: [{ text: priming }] },
          { role: 'model', parts: [{ text: 'Understood. What would you like to know?' }] },
          ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
          { role: 'user', parts: [{ text: question }] },
        ],
      });
      setAsking(false);
      setQa((prev) => [
        ...prev,
        {
          role: 'model',
          text: result.answer,
          suggestions: result.followupPrompts ?? [],
        },
      ]);
    } catch (e: any) {
      setAsking(false);
      setQaError(String(e?.message ?? e));
    }
  };

  const sendFollowup = () => askQuestion(question);

  // Auto-scroll Q&A to the bottom whenever activity changes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }, [qa.length, asking]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Top bar: back + prev/next + timestamp */}
      <div className="flex-none flex items-center gap-1.5 px-3 py-2 border-b border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)] transition-colors"
          title="Back to concepts (Esc)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Concepts
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <NavArrow
            direction="up"
            disabled={!prev}
            onClick={() => prev && onNavigate(prev.id)}
            title={prev ? `Previous: ${prev.label}` : 'No previous concept'}
          />
          <NavArrow
            direction="down"
            disabled={!next}
            onClick={() => next && onNavigate(next.id)}
            title={next ? `Next: ${next.label}` : 'No next concept'}
          />
          <button
            type="button"
            onClick={() => onSeek(concept.t)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] font-semibold text-[var(--color-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] transition-colors"
            title="Jump to this moment"
          >
            {formatTime(concept.t)}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body (scroller) */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        {/* Hero */}
        <div className="px-4 pt-4 pb-2">
          <span
            className="inline-flex items-center gap-1 h-[22px] px-2 rounded-md"
            style={{
              color: chipColorVar(concept.type),
              background: `color-mix(in oklab, ${chipColorVar(concept.type)} 14%, transparent)`,
              border: `1px solid color-mix(in oklab, ${chipColorVar(concept.type)} 40%, transparent)`,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <TypeIcon type={concept.type} size={11} />
            {chipLabel(concept.type)}
          </span>
          <h1
            className="text-[var(--color-fg)]"
            style={{
              marginTop: 10,
              fontFamily: '"Source Serif 4", Georgia, serif',
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: '-0.015em',
              lineHeight: 1.2,
            }}
          >
            {concept.label}
          </h1>
        </div>

        {/* Detail sections */}
        <div className="px-4 pb-4">
          {detailStatus === 'loading' && <DetailSkeleton />}
          {detailStatus === 'ready' && <RichText text={detailText} />}
          {detailStatus === 'error' && (
            <div className="text-[12.5px] text-[var(--color-danger)] leading-relaxed">
              Couldn't load: {detailError}
            </div>
          )}
        </div>

        {/* Starter follow-up suggestions — shown only before the first
            question is sent. Disappear once the thread kicks off; each
            assistant turn then carries its own suggestions. */}
        {detailStatus === 'ready' && qa.length === 0 && starterFollowups.length > 0 && (
          <div className="px-4 pb-3">
            <Eyebrow>Try asking</Eyebrow>
            <SuggestionChips prompts={starterFollowups} onPick={askQuestion} />
          </div>
        )}

        {/* Follow-up thread */}
        {(qa.length > 0 || asking || qaError) && (
          <div className="px-4 pt-2 pb-3">
            <Eyebrow>Follow-up</Eyebrow>
            <div className="mt-2 space-y-2.5">
              {qa.map((m, i) => {
                const isLatest = i === qa.length - 1;
                const showSuggestions =
                  isLatest &&
                  !asking &&
                  m.role === 'model' &&
                  (m.suggestions?.length ?? 0) > 0;
                return (
                  <div key={i} className="space-y-1.5">
                    <QABubble message={m} />
                    {showSuggestions && (
                      <SuggestionChips
                        prompts={m.suggestions!}
                        onPick={askQuestion}
                      />
                    )}
                  </div>
                );
              })}
              {asking && <QABubble message={{ role: 'model', text: 'Thinking…' }} thinking />}
              {qaError && (
                <div className="text-[11.5px] text-[var(--color-danger)]">
                  Couldn't answer: {qaError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex-none border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2.5">
        <div
          className="flex items-center gap-2 focus-within:border-[var(--color-accent)] transition-colors"
          style={{
            padding: '6px 6px 6px 12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
          }}
        >
          <input
            type="text"
            value={question}
            placeholder={
              detailStatus === 'ready' ? 'Ask a follow-up…' : 'Ask once the deep-dive finishes…'
            }
            disabled={detailStatus !== 'ready' || asking}
            onInput={(e) => setQuestion((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                sendFollowup();
              }
            }}
            className="flex-1 bg-transparent outline-none text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)]"
            style={{ fontSize: 13, fontFamily: 'inherit' }}
          />
          <button
            type="button"
            onClick={sendFollowup}
            disabled={!question.trim() || detailStatus !== 'ready' || asking}
            className="flex-none inline-flex items-center justify-center transition-opacity disabled:opacity-30"
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
            }}
            title="Send"
            aria-label="Send"
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
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Top-bar prev/next arrow ──────────────────────────────────────────

function NavArrow({
  direction,
  disabled,
  onClick,
  title,
}: {
  direction: 'up' | 'down';
  disabled: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={direction === 'up' ? 'Previous concept' : 'Next concept'}
      className="inline-flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-fg-muted)',
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === 'up' ? (
          <path d="M12 19V5M5 12l7-7 7 7" />
        ) : (
          <path d="M12 5v14M5 12l7 7 7-7" />
        )}
      </svg>
    </button>
  );
}

// ─── Section primitives ───────────────────────────────────────────────

function Eyebrow({ children }: { children: preact.ComponentChildren }) {
  return (
    <div
      className="text-[var(--color-fg-subtle)] font-semibold uppercase"
      style={{ fontSize: 10.5, letterSpacing: '0.14em' }}
    >
      {children}
    </div>
  );
}

/**
 * Clickable row of short follow-up prompts returned by the model. Clicking
 * one immediately sends it as the next question.
 */
function SuggestionChips({
  prompts,
  onPick,
}: {
  prompts: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {prompts.map((p, i) => (
        <button
          key={`${i}-${p}`}
          type="button"
          onClick={() => onPick(p)}
          title="Ask this"
          className="inline-flex items-center gap-1 transition-colors hover:opacity-90"
          style={{
            height: 26,
            padding: '0 12px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-accent)',
            background:
              'color-mix(in oklab, var(--color-accent) 10%, transparent)',
            border:
              '1px solid color-mix(in oklab, var(--color-accent) 35%, transparent)',
            textAlign: 'left',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p}
          </span>
        </button>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((section) => (
        <div key={section}>
          <div className="h-3 w-24 rounded shimmer mb-2" />
          <div className="space-y-1.5">
            {[92, 78, 86, 64].map((w, i) => (
              <div key={i} className="h-3 rounded shimmer" style={{ width: w + '%' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Q&A bubbles ─────────────────────────────────────────────────────

function QABubble({ message, thinking }: { message: QA; thinking?: boolean }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="whitespace-pre-wrap"
        style={{
          maxWidth: isUser ? '78%' : '92%',
          padding: '10px 14px',
          borderRadius: 14,
          fontSize: 12.5,
          lineHeight: 1.5,
          background: isUser ? 'var(--color-accent)' : 'var(--color-surface)',
          color: isUser ? 'var(--color-accent-fg)' : 'var(--color-fg)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
          fontStyle: thinking ? 'italic' : 'normal',
          opacity: thinking ? 0.7 : 1,
        }}
      >
        {message.text}
      </div>
    </div>
  );
}

// ─── Markdown rendering ──────────────────────────────────────────────

function RichText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          // First heading has no top margin; subsequent ones get one for
          // section separation.
          return (
            <div key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>
              <Eyebrow>{b.text}</Eyebrow>
            </div>
          );
        }
        if (b.type === 'list') {
          return (
            <ul key={i} className="space-y-1.5" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {b.items.map((item, j) => (
                <li
                  key={j}
                  className="flex gap-2 text-[var(--color-fg)]"
                  style={{ fontSize: 13, lineHeight: 1.55 }}
                >
                  <span
                    className="flex-none"
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: 'var(--color-fg-muted)',
                      marginTop: 8,
                    }}
                    aria-hidden
                  />
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={i}
            className="text-[var(--color-fg)]"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            {renderInline(b.text)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: 'heading'; text: string }
  | { type: 'para'; text: string }
  | { type: 'list'; items: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const out: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push({ type: 'para', text: para.join(' ').trim() });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push({ type: 'list', items: list.slice() });
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^##\s+(.+)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);

    if (h) {
      flushPara();
      flushList();
      out.push({ type: 'heading', text: h[1].trim() });
      continue;
    }
    if (bullet) {
      flushPara();
      list.push(bullet[1].trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out;
}

function renderInline(text: string): preact.ComponentChild[] {
  const parts: preact.ComponentChild[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > i) parts.push(text.slice(i, m.index));
    if (m[2]) parts.push(<strong key={m.index}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={m.index}>{m[3]}</em>);
    i = m.index + m[0].length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

