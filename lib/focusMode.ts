/**
 * Focus Mode: hide YouTube's distracting chrome (comments, recommendations,
 * Shorts shelves, end-screen cards) while keeping the Gloss panel visible.
 *
 * The panel mounts inside #secondary. Sibling elements inside #secondary
 * (the related-videos list) are hidden via CSS; Gloss's own wrapper is
 * excluded by ID.
 */

const STYLE_ID = 'gloss-focus-mode-style';

const CSS = `
/* Comments */
ytd-comments#comments,
#comments,
ytd-watch-metadata ~ ytd-comments {
  display: none !important;
}

/* Right-rail siblings inside #secondary, preserving the Gloss wrapper */
#secondary.style-scope.ytd-watch-flexy > *:not(#gloss-container-wrapper),
#related.style-scope.ytd-watch-flexy > *:not(#gloss-container-wrapper) {
  display: none !important;
}

/* Shorts shelves and mixed-content shelves that appear below the video */
ytd-reel-shelf-renderer,
ytd-rich-shelf-renderer,
ytd-shorts,
ytd-feed-filter-chip-bar-renderer {
  display: none !important;
}

/* End-screen cards / teasers at end of video */
.ytp-endscreen-content,
.ytp-ce-element,
.ytp-ce-covering-overlay,
.ytp-pause-overlay {
  display: none !important;
}

/* Merch shelf, clarify box, ads shelf (below-player distractors) */
ytd-merch-shelf-renderer,
ytd-clarification-renderer,
ytd-promoted-sparkles-web-renderer {
  display: none !important;
}

/* Entire video metadata block — title, channel row, action bar,
   description. Just the video + the Gloss panel remain. */
ytd-watch-metadata,
#above-the-fold,
#meta-contents,
#info-contents {
  display: none !important;
}
`;

export function setFocusMode(enabled: boolean): void {
  const existing = document.getElementById(STYLE_ID);
  if (!enabled) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
