import type { Concept, EntityType, TranscriptSegment } from './types';

export interface Msg {
  role: 'user' | 'model';
  text: string;
}

/**
 * Minimal Gemini REST client. Called only from the service worker.
 * No streaming, no grounding — one JSON-schema request, one response.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface RawSurfaceTerm {
  label: string;
  type: EntityType;
  timestampSec: number;
  description?: string;
}

export async function surfaceConcepts(opts: {
  apiKey: string;
  model: string;
  segments: TranscriptSegment[];
  explainInLang: string;
  difficulty: string;
  additionalContext?: string;
  videoTitle?: string;
  videoDescription?: string;
  /** If set, surface concepts only from this time window; full transcript is still
   *  sent as background context. Used by the chunked surfacing flow. */
  focusWindow?: { startSec: number; endSec: number };
  /** Concepts already surfaced in other chunks — avoid duplicating these. */
  priorConcepts?: Array<{ label: string; t: number }>;
  /** Max concepts to return from this call. Default 30 for full-video, ~6 for chunked. */
  maxConcepts?: number;
}): Promise<{ domain: string; concepts: Concept[] }> {
  const transcript = opts.segments
    .map((s) => `[${Math.floor(s.start)}] ${s.text}`)
    .join('\n');

  const focusSegments = opts.focusWindow
    ? opts.segments.filter(
        (s) => s.start >= opts.focusWindow!.startSec && s.start < opts.focusWindow!.endSec,
      )
    : null;
  const focusTranscript = focusSegments
    ? focusSegments.map((s) => `[${Math.floor(s.start)}] ${s.text}`).join('\n')
    : null;

  const readerLine = opts.additionalContext?.trim()
    ? `YOUR READER (most important — reshape what you surface and how you explain to fit this person): ${opts.additionalContext.trim()}`
    : `YOUR READER: a curious non-specialist who may or may not be familiar with the video's domain.`;

  const focusRule = opts.focusWindow
    ? `

=== SCOPE RULE (HARD CONSTRAINT) ===
This call is scoped to a single time window: ${Math.floor(opts.focusWindow.startSec)}s–${Math.floor(opts.focusWindow.endSec)}s.
- Every concept you return MUST be introduced inside that window. Its timestamp MUST fall in [${Math.floor(opts.focusWindow.startSec)}, ${Math.floor(opts.focusWindow.endSec)}).
- The full transcript below the window is context ONLY — it helps you understand how concepts connect; do NOT surface concepts from it. Other windows are handled by other calls.
- If a concept is first introduced outside the window and merely mentioned inside it, skip it.
- If the window genuinely has nothing worth surfacing, return an empty list. Do not pad.`
    : '';

  const system = `You identify concepts from a YouTube video's transcript that your reader would benefit from understanding.

${readerLine}

SELECTION: Surface every notable proper noun, specific term, technical concept, organization, person, place, event, framework, tool, policy, piece of jargon, or named reference that your reader might pause on. Dense academic, legal, policy, scientific, medical, or historical content warrants thorough surfacing; casual commentary or lifestyle content warrants selective surfacing. Never surface things the reader clearly already knows based on who they are.${focusRule}

EXPLANATION (2-4 sentences per concept, in ${opts.explainInLang}). The purpose of this card is to TEACH THE READER WHAT THE VIDEO ASSUMED THEY ALREADY KNEW. Do not paraphrase the video — the reader is already hearing it.
- Lead with what the concept is, in plain language (one short sentence).
- Spend most of the card on BACKGROUND AND CONTEXT THAT THE VIDEO DID NOT COVER — prerequisites, history, why it exists, what it's typically compared to, who established it, what era / regime / version / section it belongs to, common misconceptions. Treat this as the "filling in" layer.
- Only mention the video's angle if it's genuinely illuminating (e.g. a lesser-known interpretation the speaker is proposing). Otherwise skip it.
- Include the identifying details natural to the concept's domain — article / section / year / citation / version / institution / era / parent organization / author — whichever genuinely applies.
- If the reader has a specific goal or framing (from YOUR READER above), angle the explanation for that goal.
- Skip speculation; prefer brief over invented.

TONE: Calm, precise, fact-dense, respectful of the reader's intelligence.

QUALITY BAR: Always prefer the most specific, substantive concepts available. Do not pad the list or lower the bar to reach a target count — fewer strong concepts beats more weak ones. Returning zero concepts is acceptable when the material genuinely does not warrant any.

PREVIEW / TEASER HANDLING: Videos often open with a preview — rapid cuts or quotes of what's coming. DO NOT surface concepts from the preview. Wait until a concept is actually introduced and discussed in the main content, and anchor its timestamp there. Signals of preview: rapid topic changes in the first 30-90 seconds, phrases like "coming up", "today we'll see", "stay tuned", quick disjoint soundbites.`;

  const parts: string[] = [];
  parts.push(`Difficulty: ${opts.difficulty}. Explain-in language: ${opts.explainInLang}.`);

  if (opts.videoTitle) {
    parts.push(`\nVIDEO TITLE:\n${opts.videoTitle}`);
  }
  if (opts.videoDescription) {
    parts.push(`\nVIDEO DESCRIPTION (from the creator — use as background but don't treat as transcript):\n${opts.videoDescription}`);
  }

  if (opts.priorConcepts && opts.priorConcepts.length > 0) {
    const priorList = opts.priorConcepts
      .map((c) => `- "${c.label}" (${Math.floor(c.t)}s)`)
      .join('\n');
    parts.push(
      `\n=== ALREADY SURFACED (DO NOT REPEAT) ===
These concepts were surfaced by earlier calls on prior windows. Do NOT return any of them — the final list will include them. Treat this list purely as a dedup filter; do NOT take stylistic or quality cues from it. Hold your own bar.
${priorList}`,
    );
  }

  if (focusTranscript !== null) {
    // FOCUS SEGMENT goes first, then the full transcript as background. Small
    // models anchor on the most recent instructions, so the window we want
    // them to focus on needs to be right before the final "return concepts"
    // instruction — not buried under a 15k-line transcript.
    const cap = opts.maxConcepts ?? 6;
    const sSec = Math.floor(opts.focusWindow!.startSec);
    const eSec = Math.floor(opts.focusWindow!.endSec);
    parts.push(
      `\n=== FOCUS WINDOW TRANSCRIPT (${sSec}s–${eSec}s) — surface concepts from THIS text only ===\n${focusTranscript || '(empty — this window has no transcript lines; return an empty concepts array)'}\n=== END FOCUS WINDOW ===`,
    );
    parts.push(
      `\nFULL TRANSCRIPT (BACKGROUND ONLY — do NOT surface from here; use it only to understand how concepts in the focus window connect to the rest of the video):\n${transcript}`,
    );
    parts.push(
      `\nReturn up to ${cap} concepts from the FOCUS WINDOW only. Every timestamp MUST be in [${sSec}, ${eSec}). If the window is thin, return fewer — an empty list is fine.`,
    );
  } else {
    parts.push(`\nTRANSCRIPT:\n${transcript}`);
    const cap = opts.maxConcepts ?? 30;
    parts.push(
      `\nReturn up to ${cap} distinct concepts, each anchored to the timestamp where it's introduced in the main content (not the preview).`,
    );
  }

  const prompt = parts.join('\n');

  const schema = {
    type: 'object',
    properties: {
      domain: { type: 'string', description: 'Short label like "Web dev tutorial"' },
      concepts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'CONCEPT',
                'PERSON',
                'TOOL',
                'ORGANIZATION',
                'PLACE',
                'EVENT',
                'WORK',
                'TECHNIQUE',
                'JARGON',
              ],
            },
            timestampSec: { type: 'number' },
            description: { type: 'string' },
          },
          required: ['label', 'type', 'timestampSec', 'description'],
        },
      },
    },
    required: ['domain', 'concepts'],
  };

  const res = await fetch(`${BASE}/models/${opts.model}:generateContent?key=${opts.apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = JSON.parse(text) as { domain: string; concepts: RawSurfaceTerm[] };

  const raw = (parsed.concepts ?? []).filter(
    (c) => typeof c.timestampSec === 'number' && isFinite(c.timestampSec),
  );

  // Enforce focus-window timestamp rule: concepts anchored outside the window
  // are the model breaking the focus rule (it grabbed them from the full
  // transcript we included as context). Drop them and warn, so the merge pass
  // never sees out-of-window data.
  let filtered = raw;
  if (opts.focusWindow) {
    const { startSec, endSec } = opts.focusWindow;
    const inWindow: RawSurfaceTerm[] = [];
    const outOfWindow: RawSurfaceTerm[] = [];
    for (const c of raw) {
      if (c.timestampSec >= startSec && c.timestampSec < endSec) inWindow.push(c);
      else outOfWindow.push(c);
    }
    if (outOfWindow.length > 0) {
      console.warn(
        `[gloss/gemini] focus window ${Math.floor(startSec)}-${Math.floor(endSec)}s: model returned ${outOfWindow.length} out-of-window concept(s), dropping:`,
        outOfWindow.map((c) => `${Math.floor(c.timestampSec)}s ${c.label}`),
      );
    }
    filtered = inWindow;
    // Treat "model ignored the focus rule entirely" as a failure — caller's
    // retry logic will give it another shot, and if it keeps happening the
    // chunk gets marked failed (red bar in UI).
    if (inWindow.length === 0 && outOfWindow.length > 0) {
      throw new Error(
        `Model returned ${outOfWindow.length} concept(s) but none inside the focus window ${Math.floor(startSec)}-${Math.floor(endSec)}s — ignored the focus rule.`,
      );
    }
  }

  const concepts: Concept[] = filtered
    .map((c) => ({
      id: slug(c.label) + '-' + Math.floor(c.timestampSec),
      label: c.label,
      type: c.type,
      t: c.timestampSec,
      description: c.description,
    }))
    .sort((a, b) => a.t - b.t);

  return { domain: parsed.domain ?? '', concepts };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Non-streaming text completion from Gemini. Returns the full generated text.
 */
export async function generateText(opts: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
}): Promise<string> {
  const res = await fetch(`${BASE}/models/${opts.model}:generateContent?key=${opts.apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      contents: opts.contents,
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export function buildDetailSystem(opts: {
  explainInLang: string;
  additionalContext?: string;
}): string {
  const readerLine = opts.additionalContext?.trim()
    ? `\n\nYOUR READER (most important — shape the depth, angle, and framing to fit this person): ${opts.additionalContext.trim()}`
    : '';
  return `You are Gloss's deep-dive explainer. A user is watching a YouTube video and wants a thorough but accessible explanation of ONE specific concept from it.${readerLine}

IMPORTANT FOCUS RULE: You'll be given the full video transcript as background context. It's there so you can see HOW the speaker introduces and uses the target concept. Do NOT summarize the whole video, do NOT survey other topics, do NOT drift. Your entire response must be about the target concept. Use the transcript to quote or reference specifics only when it directly illuminates the target concept.

Write in ${opts.explainInLang}. Use clear, plain language — a knowledgeable friend on a couch, not a textbook. Structure the response with these exact markdown headings (and nothing else — no title, no h1):

## What it is
2-3 paragraphs. The plain-language definition plus enough detail that a newcomer could explain it to someone else.

## Why it matters in this video
1-2 paragraphs grounded in the transcript. Anchor to what the speaker actually says / does around this concept. If the transcript reveals a specific angle the speaker takes, call that out.

## Background
1-2 paragraphs of the history, prerequisites, or surrounding context a reader would need to fully appreciate the concept.

Avoid marketing tone and hype. Don't repeat the concept's label as the first words. Never speculate — if something isn't in the transcript or isn't well-established, say so. Do NOT add any headings besides the three above.`;
}

export function buildDetailUserContent(opts: {
  concept: Pick<Concept, 'label' | 'type' | 't'>;
  videoTitle?: string;
  videoDescription?: string;
  fullTranscript: string;
  difficulty: string;
}): string {
  const parts: string[] = [];
  if (opts.videoTitle) parts.push(`Video title: ${opts.videoTitle}`);
  if (opts.videoDescription) parts.push(`Video description:\n${opts.videoDescription.slice(0, 1200)}`);
  parts.push(
    `\n=== TARGET CONCEPT ===\n"${opts.concept.label}" (${opts.concept.type}) introduced around ${Math.floor(opts.concept.t)}s.\nThis is the ONLY concept you're explaining. Stay focused on it.`,
  );
  parts.push(`\nReader level: ${opts.difficulty}.`);
  parts.push(
    `\n=== FULL VIDEO TRANSCRIPT (context only — use to understand how the speaker treats the target concept; do not summarize the whole video) ===\n${opts.fullTranscript}`,
  );
  return parts.join('\n');
}

export function buildFollowupSystem(opts: {
  concept: Pick<Concept, 'label' | 'type'>;
  explainInLang: string;
  additionalContext?: string;
}): string {
  const readerLine = opts.additionalContext?.trim()
    ? `\n\nYOUR READER (most important — shape the depth, angle, and framing to fit this person): ${opts.additionalContext.trim()}`
    : '';
  return `You are Gloss answering follow-up questions about the concept "${opts.concept.label}" (${opts.concept.type}) from a specific YouTube video. Respond in ${opts.explainInLang}.${readerLine}

Tone: helpful, concise, calm, respectful of the reader's intelligence. Default to 1-3 short paragraphs. Only use bullet lists when the user explicitly asks or when the information is genuinely a list. No markdown headings in follow-up answers.

If the user's question drifts far from the concept, gently redirect once and then answer. Never speculate — if you don't know, say so.`;
}

export function extractWindow(
  segments: TranscriptSegment[],
  centerT: number,
  windowSec: number,
): string {
  const lo = centerT - windowSec;
  const hi = centerT + windowSec;
  return segments
    .filter((s) => s.start >= lo && s.start <= hi)
    .map((s) => `[${Math.floor(s.start)}] ${s.text}`)
    .join('\n')
    .slice(0, 3000);
}
