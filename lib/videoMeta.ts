/**
 * Best-effort extraction of the current YouTube video's title + description
 * from the DOM. Descriptions are truncated to keep the Gemini prompt bounded.
 */

const MAX_DESC_CHARS = 2000;

export interface VideoMeta {
  title?: string;
  description?: string;
}

export function readVideoMeta(): VideoMeta {
  return {
    title: readTitle(),
    description: readDescription(),
  };
}

function readTitle(): string | undefined {
  const el =
    document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
    document.querySelector('h1.title yt-formatted-string');
  const t = (el?.textContent || document.title.replace(/ - YouTube$/, '')).trim();
  return t || undefined;
}

function readDescription(): string | undefined {
  const candidates = [
    '#description-inline-expander yt-attributed-string',
    '#description-inline-expander',
    'ytd-text-inline-expander #snippet',
    'ytd-watch-metadata #description',
    '#description',
  ];
  for (const sel of candidates) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = (el?.innerText || el?.textContent || '').trim();
    if (text.length > 20) return text.slice(0, MAX_DESC_CHARS);
  }
  // Fallback — <meta name="description"> (usually truncated by YouTube).
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const content = meta?.content?.trim();
  return content ? content.slice(0, MAX_DESC_CHARS) : undefined;
}
