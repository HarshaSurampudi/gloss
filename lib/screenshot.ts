import type { BgResponse, ScreenshotRequest } from './types';

export type ScreenshotAction = 'clipboard' | 'download';

/**
 * Capture the currently-playing YouTube video frame and either copy it to
 * the clipboard or download it as a PNG. Uses chrome.tabs.captureVisibleTab
 * from the SW (bypasses canvas CORS tainting) and crops to the video's
 * bounding rect.
 */
export async function takeScreenshot(action: ScreenshotAction): Promise<void> {
  const blob = await captureVideoFrame();
  if (action === 'clipboard') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied to clipboard');
    } catch {
      download(blob);
      toast('Clipboard blocked — downloaded instead');
    }
  } else {
    download(blob);
    toast('Downloaded');
  }
}

async function captureVideoFrame(): Promise<Blob> {
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  if (!video) throw new Error('No video element found');
  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw new Error('Video not visible');

  const resp = await chrome.runtime.sendMessage<ScreenshotRequest, BgResponse<string>>({
    type: 'screenshot',
  });
  if (!resp?.ok) throw new Error(resp?.error ?? 'Capture failed');

  const img = await loadImage(resp.data);
  const scaleX = img.width / window.innerWidth;
  const scaleY = img.height / window.innerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scaleX));
  canvas.height = Math.max(1, Math.round(rect.height * scaleY));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(
    img,
    Math.round(rect.left * scaleX),
    Math.round(rect.top * scaleY),
    Math.round(rect.width * scaleX),
    Math.round(rect.height * scaleY),
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error('toBlob failed'));
      else resolve(b);
    }, 'image/png');
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

function download(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const title = (document.title.replace(/ - YouTube$/, '').trim() || 'youtube')
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  a.href = url;
  a.download = `gloss-${title}-${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TOAST_CLASS = 'gloss-screenshot-toast';

function toast(message: string) {
  const player = document.querySelector<HTMLElement>('#movie_player');
  if (!player) return;
  player.querySelector(`.${TOAST_CLASS}`)?.remove();
  const el = document.createElement('div');
  el.className = TOAST_CLASS;
  el.textContent = message;
  Object.assign(el.style, {
    position: 'absolute',
    left: '50%',
    bottom: '72px',
    transform: 'translateX(-50%) translateY(8px)',
    background: 'rgba(20, 20, 24, 0.9)',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '13px',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: '500',
    letterSpacing: '0.01em',
    zIndex: '2147483647',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 160ms ease, transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1)',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
  } as Partial<CSSStyleDeclaration>);
  player.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(4px)';
  }, 1400);
  setTimeout(() => el.remove(), 1700);
}
