# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # WXT dev server — launches a fresh Chrome with the extension pre-installed; HMR enabled
npm run build      # production build to output/chrome-mv3/  (note: outDir is "output", NOT the default ".output")
npm run zip        # store-ready zip for Chrome Web Store submission
npm run compile    # tsc --noEmit (type-check only; run this before committing)
```

There are no tests. Type-checking (`npx tsc --noEmit`) is the CI-equivalent check before building.

To install the built extension manually: `chrome://extensions` → Developer mode on → **Load unpacked** → select `output/chrome-mv3`.

## Architecture

Gloss is a Chrome MV3 extension that mounts a Preact UI into YouTube's right sidebar and uses Gemini to identify & explain concepts from the video transcript. Built with **WXT + Preact + Tailwind v4**.

### The single most important architectural decision

**The service worker is a stateless Gemini proxy. Nothing else.** It handles three `chrome.runtime.sendMessage` request types (`surface`, `detail`, `followup`), each calls Gemini, responds with the result, done. No persistent ports, no per-tab state, no transcript relay, no tick messaging.

This is deliberate — an earlier architecture used a long-lived port + 4Hz video-tick relay, and it spammed "Extension context invalidated" errors whenever the extension reloaded in dev. Do NOT reintroduce SW-held state or port-based streaming without understanding the blast radius.

Consequences:
- **All video-state reading (currentTime, durationSec) happens in the content script via rAF**, not through the SW.
- **Transcript fetching runs in the content script** (same-origin + user cookies are needed for PoToken-gated timedtext).
- **The UI talks to the SW only on user-initiated Gemini calls**: surfacing a new video, opening a deep-dive, asking a follow-up.

### Mount points

Two Shadow-DOM mounts, both in `entrypoints/inpage/mount.tsx`:

1. **Main panel** → injected into `#secondary.style-scope.ytd-watch-flexy` (above "Up next"). A `MutationObserver` waits up to 30s for that selector. The host has `clamp(360px, 52vh, 720px)` CSS fallback height but JS overrides it via `ResizeObserver` on YouTube's `#player` element so the panel height tracks the video player.

2. **Immersive overlay** (`FullscreenOverlay.tsx`) → mounted inside `document.fullscreenElement` for real fullscreen, or `#movie_player` for theater mode. Main panel is hidden (`display: none`) while immersive is active. Shared state flows through `lib/liveStore.ts` (a tiny module-level pub/sub) because the overlay is in a different Preact tree.

### Transcript fetching — PoToken

`lib/transcript.ts`: YouTube's `timedtext` endpoint requires a valid `pot` (PoToken) query param. Approach:

1. Find YouTube's own CC button (`button.ytp-subtitles-button.ytp-button`)
2. `performance.clearResourceTimings()`
3. Click the button twice (toggle on, toggle off — back to original state)
4. Poll `performance.getEntriesByType('resource')` for a URL containing `/api/timedtext?` (YouTube's own player fires this)
5. Extract the `pot` param from that URL
6. Build our own request with the valid token

DOM panel scraping is a fallback.

### Keystroke trap

`mount.tsx → trapKeystrokes(host)` attaches `keydown`/`keyup`/`keypress` bubble-phase listeners to each Shadow host. Events originating from `INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable` elements get `stopPropagation()` — prevents YouTube's document-level shortcut handlers (`m` mute, `k` play, `f` fullscreen, etc.) from firing when users type into our UI.

### Navigation detection (multi-layered)

YouTube's SPA navigation events are unreliable. `mount.tsx → startNavWatcher()` layers four detectors: `yt-navigate-finished` + `yt-page-data-updated` events, `popstate`, monkey-patched `history.pushState` / `replaceState`, and a **400ms polling fallback** on `location.search?v=`. On video change, the old wrapper div is removed, `liveStore.reset()` is called, and a fresh Preact tree mounts with the new videoId.

### Cache

`lib/cache.ts` keys three kinds in `chrome.storage.local`:
- **Transcripts** by `videoId` (version `TRANSCRIPT_VERSION`)
- **Concepts** by `(videoId, lang, difficulty, model, contextHash)` (version `CONCEPTS_VERSION`)
- **Details (deep-dive text)** by `(videoId, conceptId, lang, model)` (version `DETAIL_VERSION`)

LRU-evicted at 80 entries per kind. **Bump the relevant `*_VERSION` constant** when you change the corresponding prompt or schema; stale entries become cache misses and get replaced on next write.

### Data flow sketch

```
YouTube page
 │
 ├─ content script (entrypoints/youtube.content.ts) — tiny, only calls mountInPage()
 │    │
 │    ├─ main panel Preact tree (Shadow DOM in #secondary)
 │    │    ├─ reads <video>.currentTime via rAF (no SW involved)
 │    │    ├─ fetches transcript locally (PoToken)
 │    │    ├─ sendMessage('surface' | 'detail' | 'followup') ──────┐
 │    │    └─ writes to liveStore (for overlay sync)                │
 │    │                                                              │
 │    └─ overlay Preact tree (Shadow DOM in #movie_player)           │
 │         └─ reads from liveStore                                   │
 │                                                                   ▼
 └─ service worker (entrypoints/background.ts) — receives sendMessage, calls Gemini, responds
```

### Key files

- `entrypoints/inpage/App.tsx` — main panel state machine (status: loading-prefs → need-key → loading-transcript → idle-manual | surfacing → ready)
- `entrypoints/inpage/mount.tsx` — all DOM plumbing: mount targets, Shadow DOM setup, fullscreen/theater detection, height matching, keystroke trap, nav watcher
- `entrypoints/inpage/FullscreenOverlay.tsx` — draggable, position-persisted, store-subscribing
- `entrypoints/inpage/components/ConceptDetail.tsx` — deep-dive view + follow-up Q&A thread
- `lib/gemini.ts` — REST client + prompt builders (surfaceConcepts with JSON schema, buildDetailSystem/UserContent, buildFollowupSystem)
- `lib/transcript.ts` — PoToken-based timedtext fetch + DOM panel fallback
- `lib/progressMarkers.ts` — injects colored dots onto YouTube's progress bar (outside our Shadow DOM, so uses inline OKLCH colors rather than our CSS custom properties)
- `lib/cache.ts`, `lib/storage.ts`, `lib/liveStore.ts` — persistence layers

### When editing things

- Changing the surfacing prompt → bump `CONCEPTS_VERSION` in `lib/cache.ts`
- Changing the deep-dive prompt → bump `DETAIL_VERSION`
- Changing transcript fetch → bump `TRANSCRIPT_VERSION`
- Adding a new Preferences field → update `lib/types.ts` AND `DEFAULT_PREFS` in `lib/storage.ts`
- **All chrome API calls MUST guard with `chrome.runtime?.id`** — orphaned content scripts (after dev reload) keep running; unguarded calls spam the console

### Model selection

Uses Google's "latest" aliases only: `gemini-flash-lite-latest` (default), `gemini-flash-latest`, `gemini-pro-latest`. The model list is **hardcoded** in `lib/languages.ts`. Do not re-add the live `GET /v1beta/models` fetch — an earlier version had it and we simplified away.

## Release workflow

Gloss ships via GitHub Releases (no Chrome Web Store yet). To cut a release:

```bash
# 1. Bump version in package.json (WXT stamps the manifest from this)
#    0.1.0 → 0.1.1 for patches, → 0.2.0 for features, reserve 1.0.0 for Web Store launch

# 2. Build a fresh zip
npm run zip
# → output/gloss-<version>-chrome.zip

# 3. Commit the version bump
git add package.json
git commit -m "release: v0.1.0"

# 4. Tag and push
git tag -a v0.1.0 -m "Gloss v0.1.0"
git push origin main --tags

# 5. Publish the release with gh CLI (attaches the zip)
gh release create v0.1.0 \
  output/gloss-0.1.0-chrome.zip \
  --title "Gloss v0.1.0" \
  --notes "Release notes here."
```

Or via the GitHub UI: Releases → Draft a new release → pick the tag → drag the zip in → publish.

Don't commit the zip to git — `output/` is gitignored and GitHub hosts it via the release asset.

## Commit conventions

- Plain, lowercase imperative subject: `fix: overlay drag handle`, `feat: add manual-generate toggle`, `refactor: move transcript fetch to content script`
- Body can be terse; focus on *why* rather than *what*.
