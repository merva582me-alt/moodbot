# MoodBot — Complete Codebase Documentation Plan
<!-- CONFIRMED DECISIONS:
  - Output: single file (moodbot-full-documentation.md)
  - Injected JS depth: exhaustive (every internal function documented)
  - Code quality audit: identify issue + recommended remediation per issue
  - Diagrams: Mermaid syntax for data/event flows; ASCII for top-level architecture
-->

## Top-Level Overview

MoodBot is a Windows-only Electron desktop application (v43.2.0) that automates and manages
MeetMe live-stream broadcasts. It combines a React 19 / TypeScript / Tailwind CSS UI with a
Node.js Electron main process that drives a real Chromium browser session embedded inside the
app window.

The documentation task is **read-only reverse engineering**: no code is changed. The goal is
a complete developer manual that covers every feature, every IPC channel, every UI element,
every event, every background task, every API call, every data flow, and every configuration
option — with file names, line numbers, and code citations throughout.

**Scope:** All 15 phases listed in the user's prompt, collapsed into a logical set of
sub-tasks below. The output is a single large markdown file (`moodbot-full-documentation.md`).

---

## Sub-Tasks

---

### Sub-Task 1 — Project Architecture & Startup Sequence
**Status:** [ ] pending

**Intent:**
Establish the complete mental model of the application: process topology, folder structure,
entry points, initialization order, window/view creation, security model, sessions, build
pipeline, and shutdown flow.

**Expected Outcomes:**
- Annotated folder tree with one-line purpose for every file
- Startup sequence (step-by-step from `electron .` to first rendered frame)
- Shutdown sequence (window close → cleanup → process exit)
- Architecture diagram (Mermaid or ASCII)
- Build pipeline (dev vs production)
- Security model (contextIsolation, partitions, header stripping)

**Todo List:**
1. Write the full annotated file tree from `/` recursively
2. Document the Electron startup sequence: `app.whenReady()` → `createWindow()` →
   `stripFrameBlockingHeaders()` × 4 sessions → `setUserAgent()` → `loadFile/loadURL()`
   → `ready-to-show` → `mainWindow.show()`
3. Document React startup: `index.html` → `src/main.tsx` → `React.createRoot` → `<App />`
   → `useState` lazy initialisers → `useEffect` subscriptions
4. Document shutdown: `mainWindow.on('closed')` → `stopMetricsPolling()` →
   `activeWebContentsViews.forEach(close)` → `activeWebContentsViews.clear()` →
   `mainWindow = null`
5. Document all four Electron session partitions and why each exists
6. Document build pipeline: `npm run dev`, `npm run build`, `npm run electron:build`
7. Draw architecture diagram showing: Main Process ↔ IPC Bridge ↔ Renderer Process,
   WebContentsView (MeetMe) embedded in BrowserWindow, WebContentsView (YouTube)

**Relevant Context:**
- `main.js:716–768` — `createWindow()`, window options, load path, resize event
- `main.js:794–812` — `app.whenReady()`, session setup
- `main.js:814–816` — `window-all-closed` handler
- `main.js:755–767` — `mainWindow.on('closed')` shutdown
- `src/main.tsx` — React entry (`createRoot`, `StrictMode`)
- `index.html` — HTML shell, font import, `#root` div
- `package.json` — scripts, electron-builder config, dependencies
- `vite.config.ts` — build output, aliases, HMR

---

### Sub-Task 2 — IPC Architecture & Complete Channel Reference
**Status:** [ ] pending

**Intent:**
Document every single IPC channel: direction, payload shape, sender, receiver, purpose,
call frequency, error handling, and related files. This is the backbone of the app.

**Expected Outcomes:**
- Complete IPC channel table (all 12 channels)
- For each channel: direction, payload schema, sender file+line, receiver file+line, purpose
- Preload API surface fully documented (every method in `contextBridge.exposeInMainWorld`)
- Dual-relay pattern explained (chat forwarded on two channel names for backward compat)
- Audio ducking relay chain documented (renderer → main → renderer bounce)
- `postMessage` fallback path documented

**Todo List:**
1. Document `view:create-or-update` (invoke) — payload, bounds logic, DPI handling
2. Document `view:hide`, `view:show`, `view:destroy`, `view:navigate` (invoke)
3. Document `bot:connect` (invoke) — full login+navigate flow triggered
4. Document `bot:disconnect` (invoke) — stops polling, clears broadcastId
5. Document `bot:send-message` (invoke) — buildSendChatJS execution
6. Document `bot:scrape-metrics` (invoke) — manual DOM scrape
7. Document `audio:trigger-ducking` (invoke) — relay bounce to renderer
8. Document `meetme-chat-message` (ipcMain.on) — one-way from WebContentsView preload
9. Document `bot:chat-event` (send from main) — forwarded to renderer
10. Document `bot:metrics-update` (send from main) — metrics payload
11. Document `view:request-resize` (send from main) — resize ping
12. Document `audio:apply-ducking` (send from main) — ducking trigger to renderer
13. Document preload `sendMeetMeChat` (ipcRenderer.send) — WebContentsView → main relay
14. Document `postMessage` fallback path in chat observer and App.tsx

**Relevant Context:**
- `main.js:890–1199` — all `ipcMain.handle` and `ipcMain.on` handlers
- `preload.js:1–87` — full context bridge API
- `src/types.ts:99–158` — `window.electronAPI` TypeScript interface
- `src/App.tsx:499–571` — IPC subscription useEffect
- `src/App.tsx:458–478` — metrics update subscription
- `main.js:1169–1182` — audio ducking relay

---

### Sub-Task 3 — WebContentsView Overlay System
**Status:** [ ] pending

**Intent:**
Explain exactly how MeetMe and YouTube live inside the Electron window despite being
third-party websites that normally refuse embedding. This is one of the most unusual
architectural patterns in the app.

**Expected Outcomes:**
- Step-by-step explanation of the overlay positioning mechanism
- Explanation of why `display:none` is never used and `visibility:hidden` is used instead
- ResizeObserver + RAF double-frame + 200ms fallback timing documented
- DPI/devicePixelRatio handling documented
- Zero-size collapse (instead of destroy) pattern explained
- `stripFrameBlockingHeaders` mechanism explained (X-Frame-Options + CSP removal)
- User-agent spoofing on MeetMe partition explained
- Two-view setup (meetme_browserview + youtube_browserview) documented

**Todo List:**
1. Explain `ElectronBrowserView` component: placeholder div → `getBoundingClientRect()` →
   IPC → `WebContentsView.setBounds()` overlay positioning
2. Explain ResizeObserver → `scheduleSendBounds()` → RAF double-frame sync
3. Explain `moodbot:view-resize` CustomEvent dispatch chain from main → preload → renderer
4. Explain `view:create-or-update` handler: first-call create path vs subsequent bounds-only path
5. Document zero-size collapse: `contentView.removeChildView()` when w=0 or h=0
6. Document `stripFrameBlockingHeaders()`: intercepts all response headers on 4 sessions,
   deletes `x-frame-options`, `content-security-policy`, `content-security-policy-report-only`
7. Document `persist:meetme_browserview` user-agent: Chrome/131 spoofing
8. Document `EmbeddedLiveView` dual-tab (Livestream / YouTube) with both panels always in DOM
9. Document `visibility:hidden` + `pointerEvents:none` inactive-tab technique
10. Document web preview fallback (`<iframe>` when no `window.electronAPI`)

**Relevant Context:**
- `src/components/ElectronBrowserView.tsx:1–167`
- `src/components/EmbeddedLiveView.tsx:159–262`
- `main.js:770–1009` — `stripFrameBlockingHeaders`, `view:create-or-update` handler
- `main.js:794–812` — session setup, user-agent
- `preload.js:41–52` — `onViewRequestResize`
- `src/App.tsx:1302–1309` — stream tab always-mounted overlay technique

---

### Sub-Task 4 — MeetMe Browser Automation & Login Flow
**Status:** [ ] pending

**Intent:**
Document the browser automation engine: how MoodBot drives the embedded Chromium instance
like a human user using real keyboard/mouse input events, not JavaScript injection.

**Expected Outcomes:**
- 8-step login flow fully documented with timing constants
- All selector arrays listed for email, password, submit fields
- Cookie/consent banner dismissal: 3 strategies, 15 retries over 6 seconds
- `typeIntoFocused` character-by-character input with per-char delay
- `clickElement` getBoundingClientRect → sendInputEvent mouseDown/mouseUp
- `clearAndType` Ctrl+A → Delete → typeIntoFocused flow
- `isMeetMeLoggedIn` URL validation logic
- `meetmeLoginInProgress` flag and why it exists
- Post-login redirect polling: 30s timeout, 600ms interval
- Stream URL navigation guard (bare home URL detection)

**Todo List:**
1. Document `performBrowserLogin` step by step (Steps 1–8, lines 258–389)
2. Document `isMeetMeLoggedIn`: URL pattern logic
3. Document `waitForElement`: polling loop, 200ms interval, maxMs timeout
4. Document `dismissCookieBanner`: 3-strategy dismiss (OneTrust, button text scan, CSS hide),
   15 retry attempts, 400ms between, 300ms post-dismiss wait
5. Document `typeIntoFocused`: keyDown+char+keyUp per character, 30–50ms random delay
6. Document `clickElement`: `executeJavaScript` rect read → mouseDown → 60ms wait → mouseUp
7. Document `clearAndType`: Ctrl+A → 50ms → Delete → 50ms → typeIntoFocused
8. Document the `meetmeLoginInProgress` guard and when it fires
9. Document navigation guard in `bot:connect`: bare home URL detection (lines 1102–1116)

**Relevant Context:**
- `main.js:68–389` — all login utilities
- `main.js:1073–1131` — `bot:connect` IPC handler
- `main.js:14–18` — `meetmeLoginInProgress` global

---

### Sub-Task 5 — MeetMe Chat Capture Pipeline
**Status:** [ ] pending

**Intent:**
Trace a single chat message from the moment it appears in MeetMe's DOM until it renders
in MoodBot's chat panel. Document every step in the pipeline including both versions of the
injected observer script.

**Expected Outcomes:**
- Complete data flow: DOM → MutationObserver → IPC → React state → component render
- Both MEETME_CHAT_OBSERVER_JS versions documented (main.js vs scraper.ts) with differences
- All chat container selector arrays listed
- Message field extraction documented: username, text, avatar, level, levelColor, badge, type
- WeakSet deduplication mechanism explained
- Dual dispatch path: `window.electronAPI.sendMeetMeChat()` + `window.postMessage()` fallback
- IPC relay: `meetme-chat-message` (one-way) → forwarded on both `meetme-chat-message` AND
  `bot:chat-event` in main.js (backward compat)
- `injectChatObserver` and why guard reset + inject is atomic
- 500ms retry loop (max 120 attempts = 60 seconds) for container detection

**Todo List:**
1. Document `MEETME_CHAT_OBSERVER_JS` in `main.js:431–600`
   - Container selector list
   - `extractMessage()` function: all fields extracted
   - `dispatch()` two-path strategy
   - `setupObserver()` + MutationObserver `childList:true, subtree:true`
   - `setInterval` retry loop (500ms, max 120 attempts)
2. Document `MEETME_CHAT_OBSERVER_JS` in `src/scraper.ts:452–600`
   - Differences from main.js version
   - Additional `window.parent.postMessage` path
   - `require('electron')` ipcRenderer fallback (dead code in practice)
3. Document `injectChatObserver` (main.js:863–874): reset guard + atomic re-injection
4. Document chat subscription in `App.tsx:498–571`:
   - `onChatEvent` + `onMeetMeChatMessage` IPC subscriptions
   - `window.addEventListener('message', handleWindowMessage)` postMessage fallback
   - Dedup check: `prev.some((m) => m.id === msg.id)`
   - MAX_CHAT_MESSAGES=500 cap + slice
5. Document `processIncomingChatMessage` call triggered by every message
6. Trace full message path: MeetMe DOM → observer → IPC → App.tsx → chatMessages state →
   LiveChatPanel render

**Relevant Context:**
- `main.js:431–600` — MEETME_CHAT_OBSERVER_JS (main version)
- `main.js:863–874` — `injectChatObserver()`
- `main.js:1174–1183` — `ipcMain.on('meetme-chat-message')`
- `src/scraper.ts:452–600` — MEETME_CHAT_OBSERVER_JS (scraper version)
- `src/App.tsx:498–571` — chat subscription effect
- `src/components/LiveChatPanel.tsx:150–267` — message render

---

### Sub-Task 6 — Metrics Collection & Stream Stats
**Status:** [ ] pending

**Intent:**
Document every mechanism that produces viewer count, diamonds, likes, followers, and stream
title numbers — from MeetMe's REST API and DOM scraping, through IPC, into React state,
and onto screen.

**Expected Outcomes:**
- `fetchBroadcastMetrics` REST API call fully documented (URL, headers, response shape,
  field normalisation with null-coalescing cascade)
- `MEETME_METRICS_SCRAPER_JS` DOM scrape: three functions (viewers, diamonds, likes),
  all CSS selectors listed
- `startMetricsPolling` dual-path logic: REST first, DOM fallback
- 5-second interval documented
- `extractBroadcastId` four URL pattern strategies documented
- `bot:metrics-update` IPC payload and receiver in App.tsx documented
- Immediate on-load scrape triggered from `did-finish-load` + `did-navigate-in-page`
- `onMetricsUpdate` useEffect handler in App.tsx: null-coalescing state merge
- All StreamStats fields traced to their display location in the UI

**Todo List:**
1. Document `extractBroadcastId` (main.js:392–406): 4 patterns
2. Document `fetchBroadcastMetrics` (main.js:409–428): URL, doRequest, payload normalisation
3. Document `MEETME_METRICS_SCRAPER_JS` (main.js:603–647): 3 scrape functions + selectors
4. Document `startMetricsPolling` (main.js:819–853): interval, REST→DOM fallback
5. Document `stopMetricsPolling` (main.js:855–860)
6. Document `onPageLoad` callback (main.js:915–951): immediate scrape on did-finish-load
7. Document `onMetricsUpdate` useEffect (App.tsx:458–478): state merge with null-coalescing
8. Trace: API response → `bot:metrics-update` IPC → `setStreamStats` → sidebar viewer counter
   + EmbeddedLiveView HUD → rendered number
9. Document `handleSendHeart` optimistic local update (App.tsx:581–587)

**Relevant Context:**
- `main.js:392–428` — broadcastId extraction + REST API fetch
- `main.js:603–647` — DOM scraper JS
- `main.js:819–853` — polling loop
- `main.js:890–1009` — page-load scrape trigger inside view:create-or-update
- `src/App.tsx:458–478` — metrics update handler
- `src/components/EmbeddedLiveView.tsx:177–192` — HUD overlays

---

### Sub-Task 7 — Command Processor: All Chat Commands & Gift Detection
**Status:** [ ] pending

**Intent:**
Document every chat command MoodBot responds to, how gift events are detected, and how
the in-memory loyalty/gift tracking system works. Cite every command, every pattern, every
response template.

**Expected Outcomes:**
- Complete command reference table with trigger syntax, logic, and response
- Gift detection patterns (`Sent <Gift>!`, `sent a/an <Gift>`) documented
- `estimateGiftValue` heuristic table documented
- `formatAlertMessage` template substitution (`{user}`, `{gift}`, `{value}`) documented
- Loyalty points system: +5 per chat, +1 per diamond credit, +10 per song request
- `userLoyaltyPoints` and `userGiftTracking` in-memory stores documented
- `giftSessionTotal` and `giftGoalTotal` documented
- All 10 command passes listed in order
- Return-early logic (gift detection returns before commands) documented
- PK Battle mode flag effect on welcome/gift/follow alerts

**Todo List:**
1. Document `detectGiftInText` (commandProcessor.ts:20–43): two regex patterns
2. Document `estimateGiftValue` (commandProcessor.ts:45–51): name→value heuristic table
3. Document Welcome/Join detection (lines 153–162): type check + text includes
4. Document Follow detection (lines 164–173)
5. Document `!play` / `!sr` / `!songrequest` (lines 176–252):
   - Disable check, blocked keyword scan, SongItem creation
6. Document `!clearqueue` / `!cq` (lines 255–272)
7. Document `!skip` (lines 275–303)
8. Document `!volume <0-100>` (lines 306–331)
9. Document `!points` (lines 334–344)
10. Document `!leaderboard` (lines 347–363): top-5 sort
11. Document `!topgifters` (lines 365–381): top-5 by credits
12. Document `!commands` / `!help` (lines 383–393): command list output
13. Document `!tts <message>` (lines 395–403): `result.ttsTriggered` + `audioEngine.speakTTS`
14. Document Soundboard keyword scanner (lines 405–413): first-match, plays effect
15. Document `CommandProcessResult` return type: all fields

**Relevant Context:**
- `src/lib/commandProcessor.ts:1–418`
- `src/scraper.ts:30–77` — `stripGiftSuffix`, `cleanUsername`, `isValidUsername`
- `src/App.tsx:499–540` — `result` handling after `processIncomingChatMessage`

---

### Sub-Task 8 — Audio Engine: TTS, Ducking & Soundboard
**Status:** [ ] pending

**Intent:**
Fully document the Web Audio graph, TTS integration, auto-ducking algorithm, and all four
synthesised sound effects.

**Expected Outcomes:**
- Web Audio graph diagram: 3 channel gains → master gain → destination
- `applyGainLevels` mapping from 0-100 UI sliders to 0.0-1.0 Web Audio gain
- Ducking algorithm: fast ramp-down (50ms), duration timer, slow ramp-up (400ms)
- `speakTTS`: Web Speech API integration, estimated duration formula, ducking trigger
- All 4 built-in SFX synthesis routines documented (airhorn, cheer, drums, ding)
- Custom audio via `new Audio(dataUrl)` path documented
- Lazy init pattern (`init()` called on first use) documented
- `setDuckingCallback` → `setMixer(isDuckingActive)` React state bridge documented

**Todo List:**
1. Document `MoodBotAudioEngine` class structure and private state
2. Document `init()` (lines 41–67): AudioContext creation, 4 gain nodes, graph wiring
3. Document `applyGainLevels()` (lines 86–107): slider→gain mapping, ducking guard
4. Document `triggerDucking()` (lines 113–142): depth calc, 50ms ramp-down, timer reset
5. Document `releaseDucking()` (lines 144–156): 400ms ramp-up
6. Document `speakTTS()` (lines 162–220): voice selection, utterance params, duration estimate,
   `triggerDucking()` call, `onend`/`onerror` handlers
7. Document `playSoundboardEffect()` (lines 225–343):
   - Custom path: `new Audio(dataUrl)` + `audio.volume` + `triggerDucking(2500)`
   - airhorn: sawtooth oscillator, 3 pulses, freq ramp
   - cheer: white noise buffer, bandpass filter, gain envelope
   - drums: 8 sine oscillators at 120ms intervals, pitch descend
   - ding: sine C6→E6 glide, 1.2s envelope
8. Document `export const audioEngine = new MoodBotAudioEngine()` singleton pattern
9. Document `setDuckingCallback` → `setMixer({ isDuckingActive })` React bridge

**Relevant Context:**
- `src/lib/audioEngine.ts:1–347`
- `src/App.tsx:395–408` — audioEngine synchronization effects

---

### Sub-Task 9 — Engagement Alert System
**Status:** [ ] pending

**Intent:**
Document the welcome/gift/follow alert configuration system: the UI, the template engine,
the per-alert TTS voice override, and the battle mode suppression flag.

**Expected Outcomes:**
- All three alert types fully documented (welcome, gift, follow)
- Template placeholders: `{user}`, `{gift}`, `{value}`, `@user`, `@gift`, `@value`
- Per-alert toggles: enabled/disabled, battleInBattles, TTS on/off, voice override
- Default templates listed
- Reset-to-defaults flow documented
- Preview/test button per alert type documented
- `formatAlertMessage` substitution logic documented

**Relevant Context:**
- `src/App.tsx:223–252` — alerts state defaults
- `src/App.tsx:1487–1828` — Alerts tab UI
- `src/lib/commandProcessor.ts:53–73` — `formatAlertMessage`
- `src/lib/commandProcessor.ts:99–173` — gift/welcome/follow handling in processor

---

### Sub-Task 10 — Music Queue & Song Request System
**Status:** [ ] pending

**Intent:**
Document the music queue feature from chat command → queue entry → display → YouTube
playback, including the blocked keyword filter system.

**Expected Outcomes:**
- Full queue lifecycle: chat `!sr` → `processIncomingChatMessage` → `SongItem` creation →
  `setMusicQueue` → music tab display → YouTube tab playback
- `SongItem` schema documented
- Queue management commands: `!skip`, `!clearqueue`
- `isPlayingMusic` toggle (local UI state only — no external playback control)
- Blocked keyword filter: how keywords are stored, checked, and managed
- Default blocked keywords list
- YouTube URL resolution in `handlePlaySongOnYoutube`
- "Now Playing" sidebar widget documented
- `scoreYouTubeResult` function documented (unused in active path — noted as dead code)

**Relevant Context:**
- `src/App.tsx:258–295` — queue state, song requests enabled, blocked keywords
- `src/App.tsx:1831–2038` — Music tab UI
- `src/components/EmbeddedLiveView.tsx:69–95` — `handlePlaySongOnYoutube`
- `src/lib/commandProcessor.ts:175–253` — song request command handling
- `src/scraper.ts:380–450` — `scoreYouTubeResult` (unused)

---

### Sub-Task 11 — Soundboard System
**Status:** [ ] pending

**Intent:**
Document the soundboard feature end-to-end: trigger storage, keyword matching, audio
playback, file upload, and the CRUD management UI.

**Expected Outcomes:**
- `SoundTrigger` schema documented
- Default 4 triggers listed (gg, airhorn, hype, ding)
- Keyword matching: `lowerText.includes(st.keyword.toLowerCase())` first-match logic
- Audio playback: type dispatch to `audioEngine.playSoundboardEffect()`
- Custom file upload: FileReader → base64 dataUrl → IndexedDB storage
- Batch upload (drag & drop + file picker): auto keyword from filename
- Single-add form: keyword, title, file picker, sound type
- Edit-in-place CRUD flow
- Master enable/disable toggle
- Per-trigger enable/disable checkbox
- `singleEditFileInputRef` hidden input pattern

**Relevant Context:**
- `src/App.tsx:309–395` — soundTriggers state, file refs, form state
- `src/App.tsx:808–954` — file upload handlers + CRUD handlers
- `src/App.tsx:2184–2458` — Soundboard tab UI
- `src/lib/commandProcessor.ts:405–413` — keyword scanner
- `src/lib/audioEngine.ts:225–343` — `playSoundboardEffect`
- `src/lib/persistence.ts:1–64` — IndexedDB save/load

---

### Sub-Task 12 — Complete UI Inventory & Element Mapping
**Status:** [ ] pending

**Intent:**
Produce the Phase 3 + Phase 4 deliverables: every screen, panel, tab, and UI control
documented with source, state link, IPC link, and data trace.

**Expected Outcomes:**
- Left sidebar: brand, status counter card, nav links, now-playing widget
- Top header bar: page breadcrumb, 4 quick-toggle buttons, Start/Stop Bot button
- Tab 1 (stream): EmbeddedLiveView (7 cols), stat cards (3 cols), LiveChatPanel (5 cols)
- Tab 2 (auth): credentials form, auto-reconnect toggle, save button, error display
- Tab 3 (alerts): welcome/gift/follow alert cards with all controls
- Tab 4 (music): now-playing display, queue list, blocked keywords section
- Tab 5 (TTS): voice picker, pitch/rate sliders, test input, TTS history
- Tab 6 (soundboard): batch upload drop zone, add form, triggers grid
- Tab 7 (mixer): 3 channel sliders, ducking toggle + depth slider, status badge
- Every displayed value traced: source API/state field → component → rendered text

**Todo List:**
1. Map all sidebar elements
2. Map all header elements + quick toggles
3. Map stream tab layout (grid columns, always-mounted, visibility technique)
4. Map EmbeddedLiveView: tabs, HUD overlay, stat badges
5. Map ElectronBrowserView placeholder → WebContentsView
6. Map LiveChatPanel: message list, scroll behavior, input form, clear button
7. Map Auth tab: all 3 inputs, auto-reconnect toggle, save button, error alert
8. Map Alerts tab: 3 alert cards, all controls per card
9. Map Music tab: now-playing card, queue list, skip/clear/pause controls, blocked keywords
10. Map TTS tab: voice select, sliders, test block, history list
11. Map Soundboard tab: upload zone, add form, triggers grid, edit-in-place form
12. Map Mixer tab: 3 sliders, ducking section, status badge

**Relevant Context:**
- `src/App.tsx:956–2584` — entire render return
- `src/components/LiveChatPanel.tsx:54–304`
- `src/components/EmbeddedLiveView.tsx:97–262`

---

### Sub-Task 13 — State Management & Persistence Reference
**Status:** [ ] pending

**Intent:**
Document every piece of state in the application: React useState, refs, module-level
globals, localStorage keys, IndexedDB store, and auto-sync behaviour.

**Expected Outcomes:**
- Complete React state inventory (all useState calls in App.tsx)
- All useRef values and why they exist (stable refs for IPC subscriptions)
- All localStorage keys, default values, load path, save path
- IndexedDB: database name, version, object store, keys used
- Auto-sync effect (App.tsx:353–373) documented: what it saves and when
- In-memory stores: `userLoyaltyPoints`, `userGiftTracking`, `giftSessionTotal`
- `audioEngine` singleton state documented
- `activeWebContentsViews` Map in main.js documented
- `sessionBroadcastId`, `metricsPollingInterval`, `meetmeLoginInProgress` globals

**Todo List:**
1. List all `useState` calls (App.tsx:70–391) with type, default, and persistence
2. List all `useRef` calls with purpose
3. List all `useEffect` sync effects: what triggers them, what they write
4. Document all localStorage keys (10 keys identified)
5. Document IndexedDB: `MoodBotPersistenceDB`, `app_settings`, `soundboard_triggers`
6. Document `idbGet`/`idbSet` API
7. Document `userLoyaltyPoints`, `userGiftTracking` (commandProcessor.ts module-level)
8. Document main.js global state variables (4 vars)

**Relevant Context:**
- `src/App.tsx:69–408` — all state declarations
- `src/lib/persistence.ts:1–64`
- `src/lib/commandProcessor.ts:14–18`
- `main.js:14–27`

---

### Sub-Task 14 — Background Tasks, Timers & Auto-Reconnect
**Status:** [ ] pending

**Intent:**
Find and document every automatically-running system: intervals, timeouts, observers,
and the auto-reconnect mechanism.

**Expected Outcomes:**
- `metricsPollingInterval`: 5000ms setInterval, dual-path, stopMetricsPolling cleanup
- Chat MutationObserver: created inside WebContentsView, 500ms retry setInterval (120 attempts)
- ResizeObserver in `ElectronBrowserView`: on divRef, dispatches RAF
- `window.resize` event listener in ElectronBrowserView
- `moodbot:view-resize` CustomEvent listener in ElectronBrowserView
- `mainWindow.on('resize')` + 50ms setTimeout in createWindow
- Auto-reconnect: `triggerAutoReconnect()` 3-second setTimeout, `reconnectTimerRef`,
  `manualDisconnectRef` guard, `autoReconnectRef` stable ref
- `window.speechSynthesis.onvoiceschanged` listener
- TTS ducking timeout (`duckingTimeout` in audioEngine)

**Relevant Context:**
- `main.js:819–860` — metrics polling
- `main.js:431–600` — chat observer setInterval retry
- `main.js:747–753` — window resize → `view:request-resize`
- `src/App.tsx:124–454` — auto-reconnect, voice loading, stable ref syncs
- `src/components/ElectronBrowserView.tsx:55–135` — ResizeObserver, event listeners
- `src/lib/audioEngine.ts:135–142` — ducking timeout

---

### Sub-Task 15 — scraper.ts Deep Dive & Code Quality Audit
**Status:** [ ] pending

**Intent:**
Fully document `src/scraper.ts` including the legacy/unused portions, dead code, stub
functions, and the YouTube result scorer. Perform the Phase 14 code quality audit.

**Expected Outcomes:**
- `MEETME_DOM_EXTRACTOR_JS` (lines 81–285) documented: colour-based username extraction,
  badge detection (`getBadgeInfo`), `isGrayscale`/`isGiftGreen` colour utilities
- `ISOLATE_MEETME_STREAM_JS` (lines 286–379) documented
- `initializeScraper` (lines 602–627): STUB function returning hardcoded values — dead code
- `scoreYouTubeResult` (lines 401–450): implemented but never called — dead code
- `MEETME_CHAT_OBSERVER_JS` in scraper vs main.js: differences noted
- `YouTubeSearchResult` interface: defined but unused
- `SONG_HARD_REJECT_TITLE` / `SONG_HARD_REJECT_CHANNEL` arrays: defined, used only in
  `scoreYouTubeResult` which is itself unused
- Code quality issues: duplicate observer scripts, stub initializer, unused YouTube scorer
- `QWebEngineView.tsx` component (if it exists) — check contents
- `src/components/QWebEngineView.tsx` status

**Todo List:**
1. Document `MEETME_DOM_EXTRACTOR_JS`: all internal functions
2. Document `ISOLATE_MEETME_STREAM_JS`
3. Flag `initializeScraper` as dead code / stub (returns hardcoded viewer=142, diamonds=105)
4. Flag `scoreYouTubeResult` and `YouTubeSearchResult` as unused
5. Flag duplicate `MEETME_CHAT_OBSERVER_JS` (exists in both main.js and scraper.ts)
6. Check `QWebEngineView.tsx` — likely placeholder/stub
7. Note `hls.js` and `express` and `cheerio` in package.json — none used in current code
8. Note `@google/genai` — imported in package.json but not used in any source file
9. Identify all `TODO`, `FIXME`, hardcoded stubs, placeholder values
10. For EACH code quality issue: document the problem AND include a specific, actionable
    recommended remediation (what to change, why, and what it would unlock)

**Relevant Context:**
- `src/scraper.ts:1–627`
- `src/components/QWebEngineView.tsx` — confirmed as legacy alias (17-line wrapper)
- `package.json` — unused dependencies

---

### Sub-Task 16 — Final Developer Manual Assembly
**Status:** [ ] pending

**Intent:**
Combine all sub-task outputs into a single, complete, exhaustively cross-referenced
markdown developer manual: `moodbot-full-documentation.md`.

**Expected Outcomes:**
- Single markdown file with all 15 phases covered
- Table of contents with anchor links
- Architecture diagram (ASCII)
- Complete IPC channel table
- Complete state inventory table
- Complete command reference table
- Complete localStorage key table
- Complete UI element mapping table
- All data flows traced end-to-end
- Glossary of all classes, functions, hooks, interfaces, and managers
- Code quality issues section
- File responsibility table

**Todo List:**
1. Write Table of Contents
2. Phase 1: Architecture (from Sub-Task 1 + 2 + 3 outputs)
3. Phase 2: Feature Inventory (all features from Sub-Tasks 4–11)
4. Phase 3+4: UI Inventory + Element Mapping (Sub-Task 12)
5. Phase 5: Event Flows for every feature
6. Phase 6: IPC Documentation (Sub-Task 2)
7. Phase 7: API Documentation (MeetMe REST + browser automation)
8. Phase 8: State Management (Sub-Task 13)
9. Phase 9: Background Systems (Sub-Task 14)
10. Phase 10: Dependency Graph (who imports who, circular deps, dead code)
11. Phase 11: Feature Walkthroughs (step-by-step for each feature)
12. Phase 12: Configuration Audit (every setting)
13. Phase 13: Data Flows
14. Phase 14: Code Quality Audit (Sub-Task 15)
15. Phase 15: Glossary
16. Write all tables, diagrams, cross-references

---

## Notes for Implementation

- All documentation is **read-only** — no code changes are made
- Every claim must cite `filename:lineNumber`
- Inferred behaviour (not directly observable from code) must be labeled **Inference**
- Incomplete/broken/stub features must be labeled **STUB**, **DEAD CODE**, or **INCOMPLETE**
- Use tables wherever they add clarity
- Use ASCII for the top-level architecture overview
- Use Mermaid syntax for ALL data flows, event flows, feature walkthroughs, and dependency graphs
- The final document should be usable by a developer who has never seen the project

## Key Facts Already Confirmed

- `initializeScraper` in `scraper.ts:602–627` returns hardcoded values — never used in production
- `scoreYouTubeResult` in `scraper.ts:401–450` — implemented but never called
- `@google/genai`, `hls.js`, `express`, `cheerio` are in package.json but not used in source
- Duplicate `MEETME_CHAT_OBSERVER_JS`: one in `main.js:431`, one in `scraper.ts:452`
- `MEETME_DOM_EXTRACTOR_JS` in `scraper.ts:81–285` — injected JS not used by main.js
- `QWebEngineView.tsx` confirmed: 17-line legacy alias that simply re-exports `ElectronBrowserView`
- `isInBattle` state (App.tsx:255) — declared and threaded through command processor,
  but no UI mechanism to set it to true (always false) — **partially implemented feature**
- `TTSQueueItem.status` field has `'queued' | 'speaking' | 'completed'` but only `'completed'`
  is ever set — queue processing is not actually queued (immediate fire) — **incomplete**
