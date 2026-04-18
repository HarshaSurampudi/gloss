# Gloss

**Read the gloss. Keep watching.**

A Chrome extension that explains unfamiliar terms, people, tools, and concepts from any YouTube video — right next to the video, while you watch. Named after the medieval tradition of marginal notes that explained difficult words so readers wouldn't have to stop.

![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Why

You're watching a video. The speaker drops a term you don't recognize — a bill, a framework, a person, a piece of jargon. You'd normally hit pause, open a new tab, search it, come back, lose the thread of what was being said.

Gloss runs in the right sidebar next to the video. It reads the transcript, uses Gemini to identify concepts a general audience might not know, and explains each one in plain language — anchored to the exact timestamp where it's introduced. Click a concept, the video jumps there. Open a deep-dive, get a thorough, structured explanation. Ask a follow-up question, get an answer.

## Features

- **Concepts surfaced automatically** with types (Concept, Person, Tool, Organization, Place, Event, Work, Technique, Jargon) and 2–4 sentence explanations anchored to timestamps
- **Click any concept** → video seeks to that moment. Two-way sync: as the video plays, the active concept highlights in the panel
- **Deep-dive per concept** — a focused, structured explanation (*What it is* / *Why it matters in this video* / *Background*) plus a follow-up Q&A thread
- **Progress-bar markers** — small colored dots on YouTube's own scrubber, one per concept
- **Timeline mini-map** inside the panel with a playhead that tracks the video
- **Live caption strip** with a teleprompter view (collapsed) and a searchable full-transcript view (expanded)
- **Fullscreen + theater-mode overlay** — draggable, translucent heads-up panel with the currently-active concept. Press `S` to keep it visible
- **100+ explain-in languages**, independent of the transcript language
- **Difficulty levels** — Beginner / Intermediate / Expert / Auto
- **Personal context** — tell Gloss what you already know and it calibrates
- **Cached per video** — re-opens are instant, zero API calls
- **Manual mode** — turn auto-generate off and trigger concept surfacing per video

Zero backend. Your Gemini API key lives in `chrome.storage.local` and is only ever used from your own machine.

## Install

1. Download the latest build or run `npm run build` locally — the extension output lands in `output/chrome-mv3/`
2. Open `chrome://extensions`
3. Toggle **Developer mode** on (top-right)
4. Click **Load unpacked** → select the `output/chrome-mv3` folder
5. Open any YouTube video. Gloss appears in the right sidebar.
6. Paste a free [Gemini API key](https://aistudio.google.com/app/apikey) during onboarding.

Chrome shows a yellow "Developer mode extensions" banner on launch — that's expected for unpacked extensions.

## Develop

```bash
git clone git@github.com:HarshaSurampudi/gloss.git
cd gloss
npm install
npm run dev
```

`npm run dev` launches a fresh Chrome window with the extension pre-installed and HMR enabled. Edit any file and changes hot-reload.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with live-reloading Chrome |
| `npm run build` | Production build → `output/chrome-mv3/` |
| `npm run zip` | Store-ready zip for Chrome Web Store submission |
| `npm run compile` | TypeScript type-check (no build) |

### Stack

- [WXT](https://wxt.dev) — Manifest V3 extension framework on Vite
- Preact — rendered into Shadow DOM to isolate from YouTube's CSS
- Tailwind v4 with OKLCH color tokens for light/dark theming
- TypeScript
- Google Gemini API (Flash-Lite default; Flash and Pro selectable)

### Architecture

Gloss is split into three surfaces:

1. **Content script** mounts a Preact app into YouTube's `#secondary` column inside a Shadow DOM. It fetches the transcript, reads `video.currentTime` locally via `requestAnimationFrame`, and renders the panel.
2. **Service worker** is a stateless Gemini proxy. It receives `surface`, `detail`, and `followup` requests over `chrome.runtime.sendMessage`, calls Gemini, and responds. No persistent ports, no per-tab state.
3. **Immersive overlay** is a second Preact tree rendered into `document.fullscreenElement` (or `#movie_player` in theater mode) via a separate Shadow DOM. It subscribes to a module-level store the main panel writes into.

Transcripts are fetched by triggering YouTube's own closed-caption button, reading the resulting request URL from the Performance API, and extracting the proof-of-origin token. Caches for transcripts, concepts, and deep-dives are keyed with per-kind version constants so changes to a prompt or schema invalidate only the affected kind.

## License

MIT — see [`LICENSE`](./LICENSE).
