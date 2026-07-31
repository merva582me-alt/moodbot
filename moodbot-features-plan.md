# MoodBot Feature Expansion & Bug Fix Plan

## Overview

This plan covers 12 improvements to the MoodBot Electron app (TypeScript + React + Electron 43).
The work is broken into focused sub-tasks, each independently reviewable.
Implementation uses Agent mode; one sub-task at a time, confirmed by the user before advancing.

### Codebase Quick Reference
- Main process: `main.js` (Electron, Node.js, 1424 lines)
- Renderer entry: `src/App.tsx` (React, 2650+ lines)
- IPC bridge: `preload.cjs`
- Audio engine: `src/lib/audioEngine.ts`
- Command processor: `src/lib/commandProcessor.ts`
- Type definitions: `src/types.ts`
- Chat panel: `src/components/LiveChatPanel.tsx`
- Embedded views: `src/components/EmbeddedLiveView.tsx`, `src/components/ElectronBrowserView.tsx`
- Go reference tool for hearts: `heartsv1/heartsv1/main.go` + `curl.md`

---

## Sub-Task 1 — Fix TTS Not Playing

**Status:** `[x] done`

**Intent:**
TTS items appear in "Recent TTS History" with `status: 'completed'` but audio never plays. The root cause is a disconnect between the history state update (which fires immediately in `App.tsx`) and the actual audio engine queue (which is async). The history gets marked done before the engine even starts. Additionally, the AudioContext may be suspended due to browser autoplay policy — it requires a user gesture to resume.

**Expected Outcomes:**
- TTS audio plays correctly when triggered by alerts, commands, or the test button.
- The history accurately reflects playback state: `queued → playing → completed` (or `failed`).
- AudioContext suspension is detected and auto-resumed on the next user interaction.

**Todo List:**
1. In `src/lib/audioEngine.ts`: Add an `ensureResumed()` method that calls `audioCtx.resume()` if state is `'suspended'`, and call it at the top of `speakTTS()` and `playSoundboardEffect()`.
2. In `src/lib/audioEngine.ts`: Expose a `onTTSStatusChange(id, status)` callback hook so the engine can report `queued`, `playing`, `completed`, and `failed` states.
3. In `src/App.tsx`: Change the TTS history entry to start with `status: 'queued'` and update to `'playing'` and `'completed'` via the engine's status callback instead of marking it done upfront.
4. In `src/App.tsx`: Wire the TTS status callback to `setTtsQueue` state updates.
5. In `preload.cjs`: Confirm that `ttsSpeak` is correctly exposed and that the ArrayBuffer transfer from main → renderer is not being neutered before `decodeAudioData`.

**Relevant Context:**
- `src/lib/audioEngine.ts` lines 267–370: `speakTTS()` and `_drainTTSQueue()`
- `src/App.tsx` lines 569–578: TTS history state update (current bug — marks done immediately)
- `main.js` lines 1156–1186: `ipcMain.handle('tts:speak', ...)` — synthesizes TTS and returns buffer
- `preload.cjs`: exposes `window.electronAPI.ttsSpeak()`

---

## Sub-Task 2 — Fix Automated Alerts Sending Duplicates

**Status:** `[x] done`

**Intent:**
Automated alerts (welcome, gift, follow) can fire multiple times for the same event. The likely cause is that `processIncomingChatMessage()` is called inside a React state updater closure (stale closure issue), OR the chat message deduplication ID check is not running before the command processor is called. The fix ensures each unique event triggers exactly one alert.

**Expected Outcomes:**
- Each join/follow/gift event fires its alert exactly once, regardless of how quickly messages arrive.
- No stale closure doubles alert processing.

**Todo List:**
1. In `src/App.tsx`: Audit the `handleIncomingMessage` function — confirm that `processIncomingChatMessage()` is called after the deduplication check (`prev.some(m => m.id === msg.id)`), not before or in parallel.
2. In `src/App.tsx`: Ensure the `processIncomingChatMessage` call uses a stable ref (via `useRef`) for alert config and other state values, rather than capturing stale closure values from `useState`.
3. In `src/App.tsx`: Add a per-session processed-IDs Set (via `useRef`) that is checked before firing any alert, providing a secondary dedup guard independent of the UI state.
4. Confirm the `drainMeetMeChatBuffer` in `main.js` does not emit the same message object twice on subsequent drain ticks.

**Relevant Context:**
- `src/App.tsx` lines ~480–580: `handleIncomingMessage`, dedup logic, alert firing
- `src/lib/commandProcessor.ts` lines 94–319: `processIncomingChatMessage()`
- `main.js` lines ~540–575: `drainMeetMeChatBuffer` — emits `meetme:chat-message` IPC events

---

## Sub-Task 3 — Fix Music Player "Now Playing" Thumbnail

**Status:** `[x] done`

**Intent:**
The thumbnail in the "Now Playing" section only updates when a song is played through the bot's `!sr` command. If the user manually plays a YouTube video in the YouTube tab, the thumbnail stays stale or blank. The fix is to continuously extract the current video ID from the YouTube page URL (already being polled every 2 seconds) and update the thumbnail in real time regardless of how the song started.

**Expected Outcomes:**
- The "Now Playing" thumbnail always shows the correct thumbnail for whatever is currently playing in the YouTube tab.
- Thumbnail updates automatically on every video change, whether bot-requested or manually played.

**Todo List:**
1. In `main.js`: Extend the YouTube title polling interval (every 2 s) to also extract the current `videoId` from the page URL using the existing regex `/[?&]v=([A-Za-z0-9_-]{11})/`.
2. In `main.js`: When the `videoId` changes (different from last known), send a new IPC event `youtube:thumbnail-update` with the new `videoId`.
3. In `preload.cjs`: Expose `window.electronAPI.onYouTubeThumbnailUpdate(callback)` for the renderer.
4. In `src/App.tsx`: Listen to `youtube:thumbnail-update` and update the `nowPlayingThumbnail` state with `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`.
5. In `src/App.tsx`: Update the music panel thumbnail `<img>` src to use `nowPlayingThumbnail` state rather than a value derived only from the bot queue.

**Relevant Context:**
- `main.js` lines 733–810: YouTube title polling loop, `lastYtTitle` tracking
- `main.js` lines 847–878: `sendVideoMetadata()` — already extracts `videoId`
- `src/App.tsx` lines 673–684: `youtube:video-metadata` handler (sets thumbnail only on queue-driven loads)
- `src/App.tsx`: Music panel "Now Playing" card UI

---

## Sub-Task 4 — Concurrency & Threading Safety

**Status:** `[x] done`

**Intent:**
Multiple simultaneous events (chat burst, gifts, joins, TTS queue, soundboard, music queue advance) can cause stale state reads and race conditions in React's async state model. The core issues are: (a) alert config and flags read from stale closures in event handlers; (b) multiple rapid chat messages arriving before React re-renders can cause duplicate processing; (c) TTS ducking ref-count could desync if audio errors leave it incremented.

**Expected Outcomes:**
- Alert config, battle state, and enabled flags are always read from fresh refs, never stale closures.
- Rapid incoming messages are processed serially without duplication.
- TTS ducking ref-count is correctly reset on audio errors/failures.
- All polling intervals are properly cleaned up on disconnect to prevent ghost intervals.

**Todo List:**
1. In `src/App.tsx`: Convert mutable alert config, `isInBattle`, `soundboardEnabled`, `songRequestsEnabled`, `blockedKeywords`, and `availableVoices` to `useRef` mirrors that are kept in sync with state — pass the `.current` ref values into `processIncomingChatMessage()`.
2. In `src/App.tsx`: Move the `processIncomingChatMessage()` call inside the dedup-checked branch of `handleIncomingMessage` (i.e., only after confirming the message ID is new).
3. In `src/lib/audioEngine.ts`: In the `speakTTS()` catch/error path, ensure `releaseDucking()` is called and `ttsSpeaking` is reset to `false` so the queue can drain.
4. In `main.js`: Audit all `setInterval` calls (`drainInterval`, `ytTitleInterval`, `ytEndedInterval`, `metricsInterval`, `metricsTokenInterval`) and ensure each one is cleared in the `bot:disconnect` and `view:destroy` handlers to prevent accumulation of ghost intervals across reconnects.
5. In `main.js`: Wrap the `drainMeetMeChatBuffer` function with a guard flag (`isDraining`) to prevent re-entrant drain calls if a previous tick's `executeJavaScript` promise resolves late.

**Relevant Context:**
- `src/App.tsx` lines ~460–580: `handleIncomingMessage`, battle state, stale closures
- `src/lib/audioEngine.ts` lines 218–270: ducking ref-count, `ttsSpeaking` flag
- `main.js` lines ~730–800: polling intervals
- `main.js` lines ~543–575: `drainMeetMeChatBuffer`

---

## Sub-Task 5 — Cross-Platform Compatibility

**Status:** `[x] done`

**Intent:**
The app has a hard-coded Windows path for `userData` and a hard-coded `"Windows"` value in the Chrome user-agent platform hint. On macOS and Linux these will cause failures or incorrect behaviour.

**Expected Outcomes:**
- App data (cookies, settings) stores correctly on Windows, macOS, and Linux.
- The MeetMe session user-agent platform hint matches the actual OS.
- Build scripts include macOS and Linux targets in addition to Windows.

**Todo List:**
1. In `main.js` line 12: Remove the hard-coded `AppData/Roaming` path. Use `app.getPath('userData')` (Electron's default) which already resolves correctly per platform (`~/Library/Application Support/moodbot` on macOS, `~/.config/moodbot` on Linux).
2. In `main.js` lines 99, 107: Replace the hard-coded `"Windows"` platform hint with a dynamic value derived from `process.platform` (`'win32'` → `"Windows"`, `'darwin'` → `"macOS"`, else `"Linux"`).
3. In `package.json` build config: Add `mac` and `linux` build targets alongside the existing `win` target so `electron-builder` can produce macOS `.dmg` and Linux `.AppImage` packages.
4. In `main.js` line 49: Verify the `icon` path references a cross-platform compatible file (`.png` works everywhere; `.ico` is Windows-only). The current `assets/icon.png` is fine; no change needed unless `.ico` is referenced.

**Relevant Context:**
- `main.js` line 12: `app.setPath('userData', ...)` — hard-coded Windows path
- `main.js` lines 94–125: `spoofMeetMeSession()` — platform hint
- `package.json` `"build"` section: currently `"win"` only

---

## Sub-Task 6 — Integrated Ad Blocker for MeetMe Tab

**Status:** `[x] done`

**Intent:**
The MeetMe embedded WebContentsView loads ad network requests (doubleclick, googlesyndication, adnxs, etc.) that waste bandwidth and can interfere with the stream page. Block these at the Electron session level using `webRequest.onBeforeRequest` on the `persist:meetme` session.

**Expected Outcomes:**
- Common ad network domains are blocked silently in the MeetMe WebContentsView.
- No impact on MeetMe core functionality (stream, chat, gifts).
- No new dependencies added.

**Todo List:**
1. In `main.js`: Define a `AD_BLOCK_PATTERNS` array of URL patterns for common ad networks (doubleclick.net, googlesyndication.com, adnxs.com, ads.yahoo.com, scorecardresearch.com, etc. — ~15–20 patterns).
2. In `main.js`: In the `spoofMeetMeSession()` function (or a new `setupMeetMeAdBlock()` function called during session setup), register `session.fromPartition('persist:meetme').webRequest.onBeforeRequest({ urls: AD_BLOCK_PATTERNS }, (details, callback) => callback({ cancel: true }))`.
3. Call `setupMeetMeAdBlock()` before the `view:create-or-update` handler creates the MeetMe view, so it's active from the first page load.

**Relevant Context:**
- `main.js` lines 81–125: `stripFrameHeaders()` and `spoofMeetMeSession()` — session setup pattern to follow
- `main.js` lines 576+: `view:create-or-update` handler — MeetMe view creation

---

## Sub-Task 7 — Per-Command Permission Locks (MeetMe Badges)

**Status:** `[ ] pending`

**Intent:**
Streamers need to restrict bot commands to specific MeetMe badge roles. Each command should have a configurable minimum badge requirement settable from the UI. Available badge levels (in ascending privilege order): `everyone`, `Bouncer`, `Boss VIP`, `Black VIP`, `Purple VIP`, `Green VIP`, `Top Badge`. Commands default to `everyone`.

**Expected Outcomes:**
- A "Command Permissions" section in the bot UI (e.g., on the Alerts or a new Settings tab) lets the streamer assign a minimum badge level per command.
- `processIncomingChatMessage()` checks the sender's badge against the required level before executing any command.
- Badge permission config persists to localStorage.
- Commands that fail the permission check are silently ignored (or optionally reply with a denial message).

**Todo List:**
1. In `src/types.ts`: Add `CommandPermissionLevel` type (`'everyone' | 'Bouncer' | 'Boss VIP' | 'Black VIP' | 'Purple VIP' | 'Green VIP' | 'Top Badge'`) and `CommandPermissionsConfig` interface (map of command name → permission level).
2. In `src/types.ts`: Define the badge hierarchy order array used for comparison.
3. In `src/App.tsx`: Add `commandPermissions` state (default all `'everyone'`), persist to localStorage key `meetme_command_permissions`, and load on mount.
4. In `src/lib/commandProcessor.ts`: Add a `hasPermission(userBadge: string, requiredLevel: CommandPermissionLevel): boolean` helper using the badge hierarchy.
5. In `src/lib/commandProcessor.ts`: At the start of each command branch (`!sr`, `!skip`, `!clearqueue`, `!pause`, `!resume`, `!volume`, `!tts`, etc.), call `hasPermission()` and return early if the check fails.
6. Pass `commandPermissions` as a parameter to `processIncomingChatMessage()`.
7. In `src/App.tsx` (or a new `CommandPermissionsPanel` component): Add UI — a table/list of commands each with a dropdown for the permission level. Add this as a section within the Alerts tab or a dedicated Settings tab.

**Relevant Context:**
- `src/lib/commandProcessor.ts` lines 94–319: command dispatch
- `src/types.ts`: type definitions
- `src/App.tsx`: alert config state + localStorage persistence pattern
- `src/components/LiveChatPanel.tsx` lines 292–305: badge names already defined

---

## Sub-Task 8 — Badges in Join Messages (Chat Panel UI)

**Status:** `[ ] pending`

**Intent:**
When a user joins the stream, their MeetMe badge (MOD, VIP, Bouncer, etc.) should be visible next to their name in the join notification row inside the bot's chat panel. The badge is already scraped by `main.js` and included in the message object — it just needs to be rendered for `join`-type messages in the chat panel.

**Expected Outcomes:**
- Join notification rows in the LiveChatPanel show a colored badge chip (e.g., `[MOD]`, `[VIP]`, `[Bouncer]`) when the joining user has a badge.
- Users without a badge show no badge chip (no change to current behaviour).

**Todo List:**
1. In `src/components/LiveChatPanel.tsx`: In the render path for `message.type === 'join'`, check `msg.user?.badge` and render a badge chip using the existing `badgeColorMap` (already defined at lines 292–305) when a badge is present.
2. Ensure the badge chip style is consistent with how badges are shown for regular chat messages.
3. No scraper changes needed — `badge` is already extracted and sent in the message payload.

**Relevant Context:**
- `src/components/LiveChatPanel.tsx` lines 292–305: `badgeColorMap` definitions
- `main.js` lines 252–257: badge scraping (already captures badge into message)
- `src/types.ts`: `ChatMessage.user.badge` field

---

## Sub-Task 9 — Gift Previewer Tab

**Status:** `[ ] pending`

**Intent:**
A dedicated "Gift Previewer" tab that fetches the **live MeetMe gift catalogue** from the API (`https://api.gateway.meetme-live.com/live/gifts/catalog`, paginated) using the Bearer token already captured by the bot from the MeetMe session. Each gift card shows the thumbnail image (from the API response), name, price/value, and a Play button that triggers the gift's Lottie/Rive animation URL (also returned by the API). A live "Incoming Gifts" feed at the top shows gifts received during the current stream session.

**Expected Outcomes:**
- A new "Gifts" tab appears in the bot's tab bar.
- On tab load (or on bot connect), the bot fetches all pages of `GET /live/gifts/catalog` using `metricsToken` (the sniffed Bearer token already available in `main.js`), paginating with `?cursor=N` until no more pages.
- The tab displays a grid of gift cards: thumbnail `<img>`, gift name, diamond price, and a Play button.
- Pressing Play triggers the gift's Lottie animation (animation URL comes from the API response) embedded inline or in a modal.
- The "Incoming Gifts" feed at the top shows gifts received live during the stream (last 20), populated from the existing gift-event stream.

**Todo List:**
1. In `main.js`: Add `ipcMain.handle('gifts:fetch-catalogue', async () => { ... })` — uses `metricsToken` to fetch all pages of `https://api.gateway.meetme-live.com/live/gifts/catalog` (paginate via `?cursor=N`, stop when no `nextCursor`), returns combined array of gift objects.
2. In `preload.cjs`: Expose `window.electronAPI.fetchGiftsCatalogue()`.
3. In `src/types.ts`: Add `MeetMeGift` interface (`id`, `name`, `diamondPrice`, `thumbnailUrl`, `animationUrl`, `animationType: 'lottie' | 'rive'`) mirroring the API response shape.
4. Install `lottie-react` as a dependency for Lottie animation playback.
5. Create `src/components/GiftPreviewerTab.tsx`: A React component that:
   - Calls `window.electronAPI.fetchGiftsCatalogue()` on mount (or when the bot is connected) and stores result in local state.
   - Renders an "Incoming Gifts" feed at the top (last 20 live gift events from the current session, passed as a prop).
   - Renders a scrollable grid of gift cards below: thumbnail `<img>`, name, price chip (diamonds), and Play button.
   - On Play press, renders the Lottie animation (from `animationUrl`) in a full-card overlay or modal; clicking outside dismisses it.
6. In `src/App.tsx`: Add `'gifts'` to the `activeTab` union type and add the tab button to the tab bar.
7. In `src/App.tsx`: Pass the accumulated `incomingGifts` array (derived from existing gift events) to `GiftPreviewerTab`.
8. In `main.js`: Re-fetch the catalogue automatically when `metricsToken` is refreshed (token rotation already happens every 5 min).

**Relevant Context:**
- `main.js` lines ~1207–1265: `fetchMeetMeToken()` and `metricsToken` — the Bearer token already captured; reuse for gift catalogue requests
- `main.js` lines ~1270–1310: `pollBroadcastMetrics()` — pattern to follow for authenticated fetch in main process
- MeetMe API endpoints: `GET /live/gifts/catalog` (first page), `GET /live/gifts/catalog?cursor=1` (subsequent pages)
- `src/lib/commandProcessor.ts` lines 129–143: gift event detection (source of `incomingGifts`)
- `src/App.tsx`: tab bar, `activeTab` state, localStorage persistence pattern

---

## Sub-Task 10 — Stream Schedule Feature

**Status:** `[ ] pending`

**Intent:**
A dedicated "Schedule" tab lets the streamer define recurring weekly stream entries (day, time, title). Viewers can query the schedule via `!schedule` in chat and the bot replies with the next upcoming stream. The bot also auto-announces upcoming streams a configurable number of minutes before they start.

**Expected Outcomes:**
- A "Schedule" tab in the bot UI with a schedule editor (add/edit/remove entries, each with: day of week, start time, optional end time, stream title).
- `!schedule` chat command returns the next upcoming stream time formatted as a human-readable message.
- Auto-announcement: N minutes before a scheduled stream, the bot sends an announcement to chat (configurable, default disabled).
- Schedule persists to localStorage.

**Todo List:**
1. In `src/types.ts`: Add `ScheduleEntry` interface (`id`, `dayOfWeek: 0–6`, `startTime: HH:MM`, `endTime?: HH:MM`, `title: string`, `enabled: boolean`) and `ScheduleConfig` interface (`entries: ScheduleEntry[]`, `announceMinutesBefore: number`, `announceEnabled: boolean`, `announceMessage: string`).
2. Create `src/components/ScheduleTab.tsx`: A React component with:
   - List of schedule entries (day, time, title, enable toggle, delete button)
   - "Add Entry" form (day picker, time input, title input)
   - Auto-announce toggle + minutes-before input + message template
3. In `src/App.tsx`: Add `'schedule'` to `activeTab`, add tab button, add `scheduleConfig` state persisted to localStorage key `meetme_schedule_config`.
4. In `src/lib/commandProcessor.ts`: Handle `!schedule` command — find the next upcoming entry from `scheduleConfig.entries` relative to current day/time and return a formatted reply string.
5. Pass `scheduleConfig` to `processIncomingChatMessage()`.
6. In `src/App.tsx`: Add a `useEffect` that runs a 60-second interval checking if any schedule entry is within `announceMinutesBefore` minutes. If so, call `handleSendMessage()` with the announcement text (once per upcoming entry per session, using a `useRef` Set to avoid repeated fires).

**Relevant Context:**
- `src/lib/commandProcessor.ts`: command handling pattern
- `src/App.tsx`: `handleSendMessage()`, `useEffect` intervals, localStorage persistence pattern
- `src/App.tsx`: tab bar and `activeTab`

---

## Sub-Task 11 — Super Speed Hearts

**Status:** `[ ] pending`

**Intent:**
A "Hearts" tab that lets the streamer send hearts/likes at high speed by replaying pre-recorded HTTP requests against MeetMe's Agora stats-collector endpoints. The Go reference tool (`heartsv1/`) shows the exact approach: POST to `statscollector-1.agora.io/events/messages` and `web-2.statscollector.sd-rtn.com/events/messages` with Agora WebRTC event payloads, using a configurable concurrency worker pool.

The key integration improvement over the standalone Go tool: **the session URL is captured automatically from the MeetMe WebContentsView** (the live stream referrer URL, e.g. `https://api.gateway.meetme-live.com/web-live/view/7v0EqMsWsK/...`) so the user does not need to manually update curl payloads. The `Referer` header in all outgoing requests is patched dynamically to use the captured session URL. The Bearer token from the already-captured `metricsToken` is also available for patching `Authorization` headers if needed.

The curl.md file (bundled in `heartsv1/heartsv1/curl.md`) contains the template payloads — the bot patches the `Referer` header at runtime with the live session URL before firing each request.

**Expected Outcomes:**
- A "Hearts" tab in the bot UI with Start/Stop button, concurrency slider (default 200), and live stats (req/s, total sent, success/fail counts).
- The bot auto-captures the MeetMe live stream session URL from the WebContentsView navigation and displays it in the tab.
- Pressing Start fires concurrent HTTP requests cycling through the curl.md payloads, with `Referer` patched to the live session URL.
- Pressing Stop gracefully terminates all in-flight requests.
- The curl.md file path is configurable (defaults to bundled `heartsv1/heartsv1/curl.md`).

**Todo List:**
1. In `main.js`: When the MeetMe WebContentsView navigates to a URL matching `api.gateway.meetme-live.com/web-live/view/`, capture that URL as `heartsSessionUrl` and send a `hearts:session-url` IPC event to the renderer. Update on every navigation.
2. In `main.js`: Add a `parseCurlFile(filePath)` function (JS port of `heartsv1/main.go`'s parser) that returns an array of `{ url, method, headers: Record<string,string>, body }` objects.
3. In `main.js`: Add `ipcMain.handle('hearts:load-requests', async (_e, filePath) => parseCurlFile(filePath))`.
4. In `main.js`: Add `ipcMain.handle('hearts:start', async (_e, { concurrency, sessionUrl }) => ...)` that:
   - Parses requests from the bundled `curl.md` (or user-selected file)
   - Patches each request's `Referer` header with `sessionUrl`
   - Runs a semaphore-based worker pool (same pattern as the Go tool) using Node.js `fetch` (available in Electron's Node 18+)
   - Tracks `totalOk` and `totalFail` counters
   - Sends `hearts:stats` IPC events to renderer every second: `{ rps, totalOk, totalFail }`
   - Sets `heartsRunning` flag; loop exits when flag is false
5. In `main.js`: Add `ipcMain.handle('hearts:stop', () => { heartsRunning = false; })`.
6. In `preload.cjs`: Expose `heartsLoadRequests`, `heartsStart`, `heartsStop`, `onHeartsStats`, `onHeartsSessionUrl`.
7. Create `src/components/HeartsTab.tsx`: UI with:
   - Auto-captured session URL display (read-only field, populated from `hearts:session-url` IPC event)
   - Concurrency slider (10–500, default 200)
   - Start / Stop button (disabled if no session URL captured yet)
   - Live stats: req/s, total sent, success count, fail count
   - Status badge: "Running" / "Stopped" / "Waiting for session"
   - Optional: file picker to load a custom curl.md
8. In `src/App.tsx`: Add `'hearts'` to `activeTab` and add tab button.

**Relevant Context:**
- `heartsv1/heartsv1/main.go`: Go reference implementation to port to JS (semaphore pattern, curl parser)
- `heartsv1/heartsv1/curl.md`: Template payloads with Agora stats-collector URLs and event bodies
- `main.js` lines ~576–978: WebContentsView `did-navigate` / `did-finish-load` event hooks — pattern for capturing navigation URLs
- `main.js` `metricsToken`: already-captured Bearer token available for header patching if needed
- `preload.cjs`: IPC bridge exposure pattern

---

## Sub-Task 12 — Window Title: "Stream Title: <Current Stream Title>"

**Status:** `[x] done`

**Intent:**
The Electron window title is currently static `'MoodBot'`. It should update dynamically to `Stream Title: <Current Stream Title>` using the stream description/title already fetched from the MeetMe metrics API. When no stream is active, it should fall back to `'MoodBot'`.

**Expected Outcomes:**
- When connected to a stream, the window title bar reads `Stream Title: <title>` where `<title>` is the stream description from the MeetMe broadcast metadata API.
- When disconnected or the title is empty, the window title reverts to `'MoodBot'`.

**Todo List:**
1. In `main.js`: In the `pollBroadcastMetrics` function, when `streamDescription` (or equivalent field) is received and is non-empty, call `mainWindow.setTitle('Stream Title: ' + streamDescription)`.
2. In `main.js`: In the `bot:disconnect` IPC handler (or metrics stop), call `mainWindow.setTitle('MoodBot')` to reset the title.
3. No renderer changes needed — `mainWindow.setTitle()` updates the OS window title directly.

**Relevant Context:**
- `main.js` lines ~1270–1310: `pollBroadcastMetrics()` — parses `streamDescription` from API response
- `main.js` line 45: static `title: 'MoodBot'` in `BrowserWindow` constructor
- `main.js` lines ~1412: `bot:disconnect` handler

---

## Implementation Order

Sub-tasks are ordered from lowest-risk/most-isolated to highest-risk/most-invasive:

1. **Sub-Task 12** — Window title (2-line change, zero risk)
2. **Sub-Task 8** — Badges in join messages (UI-only, low risk)
3. **Sub-Task 6** — Ad blocker (isolated session config, low risk)
4. **Sub-Task 5** — Cross-platform fixes (targeted path fix, low risk)
5. **Sub-Task 3** — Now Playing thumbnail (YouTube polling extension, medium)
6. **Sub-Task 1** — TTS fix (audio engine + state changes, medium)
7. **Sub-Task 2** — Alert duplicate fix (state + command processor, medium)
8. **Sub-Task 4** — Concurrency/threading (cross-cutting, medium-high)
9. **Sub-Task 7** — Command permissions (new types + UI + processor, medium-high)
10. **Sub-Task 10** — Stream Schedule (new tab + feature, medium-high)
11. **Sub-Task 11** — Super Speed Hearts (new tab + main process IPC, medium-high)
12. **Sub-Task 9** — Gift Previewer (new tab + dependency, medium-high)

> Note: Sub-Task 9 (Gift Previewer) animation implementation is scaffolded but fully populating gift data (thumbnails, Lottie/Rive files) awaits assets from the user.
