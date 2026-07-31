# Stream Video Fit — MeetMe Preview Window Plan

## Top-Level Overview

The MeetMe preview window in the Stream & Chat tab renders inside an injected CSS environment controlled by `ISOLATE_MEETME_STREAM_JS` in `src/scraper.ts`. This JavaScript string is injected into the MeetMe WebContentsView and applies CSS that forces `.stream-left-bottom-holder` to fill the full viewport.

**The problem:** The injected CSS has no targeted rules for the inner layout elements:
- `.tmg-video-stream-container-layout` — the flex/grid wrapper that divides the main stream from the guest boxes
- `.tmg-video-stream-container` / `.tmg-video-stream-content` — the main streamer's video cell
- `.tmg-video-guest` / `.tmg-video-guest-stream-container` — individual guest video cells
- The Agora video player `div` wrappers (e.g. `#agora-video-player-track-*`)
- All `video.agora_video_player` elements

The current rule forces the outer container (`.stream-left-bottom-holder`) to center its children (`justify-content: center; align-items: center`) and sets `object-fit: contain` on all videos — which causes letterboxing/black bars. The `.tmg-video-stream-container-layout` div itself doesn't stretch to fill the parent, so all three layouts (solo, guests, battle) leave empty space around the video content.

**The fix:** A single sub-task — add targeted CSS rules inside the existing injected style block in `ISOLATE_MEETME_STREAM_JS` so that every video element and container fills its available space with `object-fit: cover`, regardless of which layout mode MeetMe is in.

---

## Sub-Tasks

---

### Sub-Task 1 — Add targeted CSS rules to `ISOLATE_MEETME_STREAM_JS` for all three stream layouts

**Intent**  
Extend the injected CSS string in `ISOLATE_MEETME_STREAM_JS` to include explicit rules for the inner video layout elements so that:
- The layout container fills the full parent
- Main stream video and guest video cells each fill their respective slots
- All `<video>` elements use `object-fit: cover` (no black bars)
- This works whether the streamer is solo, has guests, or is in a battle

**Expected Outcomes**  
- Solo stream: single video fills the entire preview window, no black bars
- With guests: main streamer video fills its cell, each guest video fills its cell — no empty corners or black bars in any cell
- Battle mode: same — each participant's video fills their cell

**Todo List**  
1. Open `src/scraper.ts` and locate `ISOLATE_MEETME_STREAM_JS` (line 289)
2. Inside the `style.textContent` template literal, **remove** the existing `.stream-left-bottom-holder` flex centering (`justify-content: center; align-items: center`) and change to `overflow: hidden` so content fills without centering gaps
3. Add rule: `.tmg-video-stream-container-layout { width: 100% !important; height: 100% !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; }`
4. Add rule: `.tmg-video-stream-container, .tmg-video-stream-content { width: 100% !important; height: 100% !important; flex: 1 !important; min-height: 0 !important; position: relative !important; overflow: hidden !important; }`
5. Add rule: `.tmg-video-guest { width: 100% !important; height: 100% !important; display: flex !important; overflow: hidden !important; }`
6. Add rule: `.tmg-video-guest-stream-container { width: 100% !important; height: 100% !important; flex: 1 !important; position: relative !important; overflow: hidden !important; }`
7. Add rule: `[id^="agora-video-player-track-"] { width: 100% !important; height: 100% !important; position: absolute !important; inset: 0 !important; overflow: hidden !important; }`
8. Add rule: `video.agora_video_player { object-fit: cover !important; width: 100% !important; height: 100% !important; position: absolute !important; inset: 0 !important; }`
9. Change the existing `video` rule at the bottom of the injected CSS (lines 352–357) to use `object-fit: cover !important` instead of `object-fit: contain !important`
10. Change the `injectCleanStyles` guard from `if (document.getElementById('meetme-clean-stream-style')) return;` to remove and re-create on each call (OR keep the guard but force the style to be fresh) — this ensures updated styles replace old ones on SPA navigation. The simplest approach: change the guard to always update `style.textContent` if the element already exists.

**Relevant Context**  
- `src/scraper.ts` lines 289–377 — the full `ISOLATE_MEETME_STREAM_JS` constant
- The injected `<style id="meetme-clean-stream-style">` element
- MeetMe DOM classes from the user-provided HTML: `.tmg-video-stream-container-layout`, `.tmg-video-stream-container`, `.tmg-video-stream-content`, `.tmg-video-guest`, `.tmg-video-guest-stream-container`, `video.agora_video_player`, `[id^="agora-video-player-track-"]`

**Status** `[ ] pending`

---

## Implementation Notes

- All changes are confined to a single constant string in `src/scraper.ts` — no React components, no other files
- The MutationObserver and `setInterval` already re-apply the style, so new rules will persist through MeetMe's SPA navigation and dynamic DOM changes
- `object-fit: cover` crops the video edges to fill the container — this is intentional for the "snug fit" the user wants. If the user prefers letterboxing instead of cropping, they would use `object-fit: contain`.
- The `[id^="agora-video-player-track-"]` attribute selector (starts-with) covers all Agora player divs without needing specific IDs
