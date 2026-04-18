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
}): Promise<{ domain: string; concepts: Concept[] }> {
  const transcript = opts.segments
    .map((s) => `[${Math.floor(s.start)}] ${s.text}`)
    .join('\n');

  const system = `You identify concepts, names, tools, organizations, places, events, works, techniques, or jargon that a general audience might not immediately recognize in a video transcript. Be DOMAIN-NEUTRAL — the video could be about anything.

For each concept, write a clear plain-language explanation (2-4 sentences) in ${opts.explainInLang}:
- What it is in plain terms
- Why it matters / how it's being used in this specific video (use transcript context)
- Any essential background a newcomer needs

Explanations should stand alone — a reader who skips the video should understand each concept from the card alone. Never speculate; if something is unclear, keep the explanation brief rather than inventing detail.

PREVIEW / TEASER HANDLING: Many videos open with a short preview — quick cuts of footage or quotes that show what's coming later. DO NOT pull concepts from the preview section. Wait until a concept is actually introduced and discussed in the main content, and anchor its timestamp to that introduction. If the same term appears in the preview and later in substance, use the substantive later timestamp, not the preview one. Signals of preview / teaser: rapid topic changes in the first 30-90 seconds, "coming up", "today we'll see", "stay tuned", quick disjoint soundbites.`;

  const parts: string[] = [];
  parts.push(`Difficulty: ${opts.difficulty}. Explain-in language: ${opts.explainInLang}.`);

  if (opts.videoTitle) {
    parts.push(`\nVIDEO TITLE:\n${opts.videoTitle}`);
  }
  if (opts.videoDescription) {
    parts.push(`\nVIDEO DESCRIPTION (from the creator — use as background but don't treat as transcript):\n${opts.videoDescription}`);
  }
  if (opts.additionalContext?.trim()) {
    parts.push(
      `\nADDITIONAL USER CONTEXT (use this to calibrate which concepts to surface and how to describe them):\n${opts.additionalContext.trim()}`,
    );
  }
  parts.push(`\nTRANSCRIPT:\n${transcript}`);
  parts.push(
    `\nReturn up to 30 distinct concepts, each anchored to the timestamp where it's introduced in the main content (not the preview).`,
  );

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

  const concepts: Concept[] = (parsed.concepts ?? [])
    .filter((c) => typeof c.timestampSec === 'number' && isFinite(c.timestampSec))
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
  const ctx = opts.additionalContext?.trim()
    ? `\n\nAdditional user context:\n${opts.additionalContext.trim()}`
    : '';
  return `You are Gloss's deep-dive explainer. A user is watching a YouTube video and wants a thorough but accessible explanation of ONE specific concept from it.

IMPORTANT FOCUS RULE: You'll be given the full video transcript as background context. It's there so you can see HOW the speaker introduces and uses the target concept. Do NOT summarize the whole video, do NOT survey other topics, do NOT drift. Your entire response must be about the target concept. Use the transcript to quote or reference specifics only when it directly illuminates the target concept.

Write in ${opts.explainInLang}. Use clear, plain language — a knowledgeable friend on a couch, not a textbook. Structure the response with these exact markdown headings (and nothing else — no title, no h1):

## What it is
2-3 paragraphs. The plain-language definition plus enough detail that a newcomer could explain it to someone else.

## Why it matters in this video
1-2 paragraphs grounded in the transcript. Anchor to what the speaker actually says / does around this concept. If the transcript reveals a specific angle the speaker takes, call that out.

## Background
1-2 paragraphs of the history, prerequisites, or surrounding context a reader would need to fully appreciate the concept.

Avoid marketing tone and hype. Don't repeat the concept's label as the first words. Never speculate — if something isn't in the transcript or isn't well-established, say so. Do NOT add any headings besides the three above.${ctx}`;
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
  const ctx = opts.additionalContext?.trim()
    ? `\n\nAdditional user context:\n${opts.additionalContext.trim()}`
    : '';
  return `You are Gloss answering follow-up questions about the concept "${opts.concept.label}" (${opts.concept.type}) from a specific YouTube video. Respond in ${opts.explainInLang}.

Tone: helpful, concise, calm, respectful of the reader's intelligence. Default to 1-3 short paragraphs. Only use bullet lists when the user explicitly asks or when the information is genuinely a list. No markdown headings in follow-up answers.

If the user's question drifts far from the concept, gently redirect once and then answer. Never speculate — if you don't know, say so.${ctx}`;
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
