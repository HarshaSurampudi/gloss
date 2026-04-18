import {
  buildDetailSystem,
  buildDetailUserContent,
  buildFollowupSystem,
  generateText,
  surfaceConcepts,
  translateSegments,
} from '@/lib/gemini';
import { getPrefs } from '@/lib/storage';
import type {
  BgResponse,
  DetailRequest,
  FollowupRequest,
  SurfaceRequest,
  SurfaceResult,
  TranslateRequest,
} from '@/lib/types';

/**
 * The service worker is a thin Gemini proxy. It handles a single request
 * type: `surface`. No persistent ports, no tab-state caching, no streaming.
 */
export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (
      msg: SurfaceRequest | DetailRequest | FollowupRequest | TranslateRequest,
      _sender,
      sendResponse,
    ) => {
      if (msg?.type === 'surface') {
        (async () => {
          try {
            const prefs = await getPrefs();
            if (!prefs.geminiApiKey) {
              sendResponse({ ok: false, error: 'No API key set.' } satisfies BgResponse<SurfaceResult>);
              return;
            }
            const data = await surfaceConcepts({
              apiKey: prefs.geminiApiKey,
              model: msg.model || prefs.geminiModel,
              segments: msg.segments,
              explainInLang: msg.explainInLang,
              difficulty: msg.difficulty,
              additionalContext: msg.additionalContext,
              videoTitle: msg.videoTitle,
              videoDescription: msg.videoDescription,
            });
            sendResponse({ ok: true, data } satisfies BgResponse<SurfaceResult>);
          } catch (e: any) {
            sendResponse({ ok: false, error: String(e?.message ?? e) } satisfies BgResponse<SurfaceResult>);
          }
        })();
        return true;
      }

      if (msg?.type === 'detail') {
        (async () => {
          try {
            const prefs = await getPrefs();
            if (!prefs.geminiApiKey) {
              sendResponse({ ok: false, error: 'No API key set.' } satisfies BgResponse<string>);
              return;
            }
            const fullTranscript = msg.segments
              .map((s) => `[${Math.floor(s.start)}] ${s.text}`)
              .join('\n');
            const system = buildDetailSystem({
              explainInLang: msg.explainInLang,
              additionalContext: msg.additionalContext,
            });
            const user = buildDetailUserContent({
              concept: msg.concept,
              videoTitle: msg.videoTitle,
              videoDescription: msg.videoDescription,
              fullTranscript,
              difficulty: msg.difficulty,
            });
            const text = await generateText({
              apiKey: prefs.geminiApiKey,
              model: msg.model || prefs.geminiModel,
              systemInstruction: system,
              contents: [{ role: 'user', parts: [{ text: user }] }],
            });
            sendResponse({ ok: true, data: text } satisfies BgResponse<string>);
          } catch (e: any) {
            sendResponse({ ok: false, error: String(e?.message ?? e) } satisfies BgResponse<string>);
          }
        })();
        return true;
      }

      if (msg?.type === 'translate') {
        (async () => {
          try {
            const prefs = await getPrefs();
            if (!prefs.geminiApiKey) {
              sendResponse({ ok: false, error: 'No API key set.' } satisfies BgResponse<string[]>);
              return;
            }
            const texts = await translateSegments({
              apiKey: prefs.geminiApiKey,
              model: msg.model || prefs.geminiModel,
              segments: msg.segments,
              sourceLang: msg.sourceLang,
              targetLang: msg.targetLang,
            });
            sendResponse({ ok: true, data: texts } satisfies BgResponse<string[]>);
          } catch (e: any) {
            sendResponse({ ok: false, error: String(e?.message ?? e) } satisfies BgResponse<string[]>);
          }
        })();
        return true;
      }

      if (msg?.type === 'followup') {
        (async () => {
          try {
            const prefs = await getPrefs();
            if (!prefs.geminiApiKey) {
              sendResponse({ ok: false, error: 'No API key set.' } satisfies BgResponse<string>);
              return;
            }
            const system = buildFollowupSystem({
              concept: msg.concept,
              explainInLang: msg.explainInLang,
              additionalContext: msg.additionalContext,
            });
            const priming = `Deep-dive context you previously wrote about this concept:\n\n${msg.detailText}\n\n(This is background — answer the user's follow-up question below.)`;
            const contents = [
              { role: 'user' as const, parts: [{ text: priming }] },
              { role: 'model' as const, parts: [{ text: 'Understood. What would you like to know?' }] },
              ...msg.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
              { role: 'user' as const, parts: [{ text: msg.question }] },
            ];
            const text = await generateText({
              apiKey: prefs.geminiApiKey,
              model: msg.model || prefs.geminiModel,
              systemInstruction: system,
              contents,
            });
            sendResponse({ ok: true, data: text } satisfies BgResponse<string>);
          } catch (e: any) {
            sendResponse({ ok: false, error: String(e?.message ?? e) } satisfies BgResponse<string>);
          }
        })();
        return true;
      }

      return false;
    },
  );
});
