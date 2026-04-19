import { useEffect, useRef, useState } from 'preact/hooks';
import type { Concept, Preferences, TranscriptSegment } from '@/lib/types';
import { getCachedDetail, setCachedDetail } from '@/lib/cache';
import { readVideoMeta } from '@/lib/videoMeta';
import {
  buildDetailSystem,
  buildDetailUserContent,
  buildFollowupSystem,
  generateText,
} from '@/lib/gemini';
import { chipColorVar, chipLabel, formatTime } from '../utils';
import { TypeIcon } from './TypeIcon';

interface ConceptDetailProps {
  videoId: string;
  concept: Concept;
  segments: TranscriptSegment[];
  prefs: Preferences;
  onBack: () => void;
  onSeek: (t: number) => void;
}

type DetailStatus = 'loading' | 'ready' | 'error';

interface QA {
  role: 'user' | 'model';
  text: string;
}

export function ConceptDetail({
  videoId,
  concept,
  segments,
  prefs,
  onBack,
  onSeek,
}: ConceptDetailProps) {
  const [detailText, setDetailText] = useState('');
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('loading');
  const [detailError, setDetailError] = useState<string | null>(null);

  const [qa, setQa] = useState<QA[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const difficulty = prefs.difficulty === 'auto' ? 'intermediate' : prefs.difficulty;

  // Load detail: cache first, else call SW.
  useEffect(() => {
    let cancelled = false;
    setDetailText('');
    setDetailStatus('loading');
    setDetailError(null);
    setQa([]);

    (async () => {
      const cached = await getCachedDetail(videoId, concept.id, prefs.explainInLang, prefs.geminiModel);
      if (cancelled) return;
      if (cached) {
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
        const text = await generateText({
          apiKey: prefs.geminiApiKey,
          model: prefs.geminiModel,
          systemInstruction: buildDetailSystem({
            explainInLang: prefs.explainInLang,
            additionalContext: prefs.additionalContext,
          }),
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildDetailUserContent({
                    concept,
                    videoTitle: meta.title,
                    videoDescription: meta.description,
                    fullTranscript,
                    difficulty,
                  }),
                },
              ],
            },
          ],
        });
        if (cancelled) return;
        setDetailText(text);
        setDetailStatus('ready');
        setCachedDetail(videoId, concept.id, prefs.explainInLang, prefs.geminiModel, text);
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

  const sendFollowup = async () => {
    const q = question.trim();
    if (!q || asking || detailStatus !== 'ready') return;
    if (!prefs.geminiApiKey) {
      setQaError('No API key set.');
      return;
    }
    const history = qa.slice();
    setQa([...qa, { role: 'user', text: q }]);
    setQuestion('');
    setAsking(true);
    setQaError(null);

    try {
      const priming = `Deep-dive context you previously wrote about this concept:\n\n${detailText}\n\n(This is background — answer the user's follow-up question below.)`;
      const text = await generateText({
        apiKey: prefs.geminiApiKey,
        model: prefs.geminiModel,
        systemInstruction: buildFollowupSystem({
          concept,
          explainInLang: prefs.explainInLang,
          additionalContext: prefs.additionalContext,
        }),
        contents: [
          { role: 'user', parts: [{ text: priming }] },
          { role: 'model', parts: [{ text: 'Understood. What would you like to know?' }] },
          ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
          { role: 'user', parts: [{ text: q }] },
        ],
      });
      setAsking(false);
      setQa((prev) => [...prev, { role: 'model', text }]);
    } catch (e: any) {
      setAsking(false);
      setQaError(String(e?.message ?? e));
    }
  };

  // When Q&A activity changes, snap the scroller to the bottom so users
  // always see their latest question / the incoming answer, even if they
  // were scrolled up in the detail text.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }, [qa.length, asking]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
          title="Back to concepts (Esc)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Concepts
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSeek(concept.t)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-[var(--color-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)]"
            title="Jump to this moment"
          >
            {formatTime(concept.t)}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
            <span
              className="inline-flex items-center gap-1 h-[20px] px-2 rounded-[4px] text-[10.5px] font-semibold uppercase tracking-[0.06em]"
              style={{
                color: chipColorVar(concept.type),
                background: `color-mix(in oklab, ${chipColorVar(concept.type)} 16%, transparent)`,
              }}
            >
              <TypeIcon type={concept.type} size={11} />
              {chipLabel(concept.type)}
            </span>
          </div>
          <div className="text-[17px] font-bold leading-tight">{concept.label}</div>
        </div>

        <div className="px-3 pb-3 pt-1">
          {detailStatus === 'loading' && <DetailSkeleton />}
          {detailStatus === 'ready' && <RichText text={detailText} />}
          {detailStatus === 'error' && (
            <div className="text-[12px] text-[var(--color-danger)] leading-relaxed">
              Couldn't load: {detailError}
            </div>
          )}
        </div>

        {(qa.length > 0 || asking || qaError) && (
          <div className="px-3 pb-3 border-t border-[var(--color-border-subtle)] pt-3 space-y-2.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Follow-up
            </div>
            {qa.map((m, i) => (
              <QABubble key={i} message={m} />
            ))}
            {asking && <QABubble message={{ role: 'model', text: 'Thinking…' }} thinking />}
            {qaError && (
              <div className="text-[11.5px] text-[var(--color-danger)]">Couldn't answer: {qaError}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-2 py-2">
        <div className="flex items-end gap-1.5 p-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)]">
          <textarea
            rows={1}
            value={question}
            placeholder={detailStatus === 'ready' ? 'Ask a follow-up…' : 'Ask once the deep-dive finishes…'}
            disabled={detailStatus !== 'ready' || asking}
            onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendFollowup();
              }
            }}
            className="flex-1 resize-none bg-transparent text-[12.5px] leading-relaxed text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none max-h-32"
          />
          <button
            type="button"
            onClick={sendFollowup}
            disabled={!question.trim() || detailStatus !== 'ready' || asking}
            className="flex-none w-7 h-7 inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)] disabled:opacity-30"
            title="Send"
            aria-label="Send"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <div>
        <div className="h-3 w-24 rounded shimmer mb-2" />
        <div className="space-y-1.5">
          {[92, 78, 86, 64].map((w, i) => (
            <div key={i} className="h-3 rounded shimmer" style={{ width: w + '%' }} />
          ))}
        </div>
      </div>
      <div>
        <div className="h-3 w-28 rounded shimmer mb-2" />
        <div className="space-y-1.5">
          {[88, 72, 80].map((w, i) => (
            <div key={i} className="h-3 rounded shimmer" style={{ width: w + '%' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function QABubble({ message, thinking }: { message: QA; thinking?: boolean }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[92%] px-2.5 py-1.5 rounded-lg text-[12.5px] leading-relaxed whitespace-pre-wrap"
        style={{
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

function RichText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) =>
        b.type === 'heading' ? (
          <div
            key={i}
            className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] mt-1"
          >
            {b.text}
          </div>
        ) : (
          <p key={i} className="text-[13px] leading-relaxed text-[var(--color-fg)]">
            {renderInline(b.text)}
          </p>
        ),
      )}
    </div>
  );
}

type Block = { type: 'heading'; text: string } | { type: 'para'; text: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push({ type: 'para', text: para.join(' ').trim() });
      para = [];
    }
  };
  for (const line of lines) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      flush();
      out.push({ type: 'heading', text: h[1].trim() });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
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
