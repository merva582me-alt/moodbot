# UI Layout Responsive Fill Plan

## Top-Level Overview

The app has a fixed-width sidebar and a main content area that fills the rest of the screen. The **Stream & Chat** tab already works correctly — it uses `position: absolute; inset: 0; overflow: hidden` with an internal grid/flex layout that fills the entire viewport at any window size.

All other tabs share a **single `overflow-auto` scrollable wrapper** (line 1728–1735 in `src/App.tsx`). This is the root cause of the problem:
- Content is centered with `max-w-3xl mx-auto` leaving huge dead space on the sides
- The page scrolls instead of filling — there is empty space below the cards
- Panels don't stretch to match the window height

The fix is to give **every non-stream tab its own `absolute inset-0 overflow-hidden` container** (same pattern as the Stream tab), then redesign each tab's interior layout to fill that space using flex/grid with `flex-1` for growing panels and `overflow-y-auto` for scrollable sub-sections.

The shared `overflow-auto` wrapper at line 1728 will be **removed entirely** — each tab becomes a self-contained full-bleed overlay just like the stream tab.

---

## Architecture Pattern (same as Stream tab)

Each tab follows this structure:
```
<div style={{ position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: 'grid', gridTemplateColumns: '...', gap: '24px',
              visibility: activeTab === 'X' ? 'visible' : 'hidden',
              pointerEvents: activeTab === 'X' ? 'auto' : 'none' }}>

  {/* COLUMN 1 — left panel */}
  <div style={{ gridColumn: 'span N', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', minHeight: 0 }}>
    <div className="shrink-0"> {/* fixed header/controls */} </div>
    <div className="flex-1 overflow-y-auto no-scrollbar"> {/* scrollable content */} </div>
  </div>

  {/* COLUMN 2 — right panel */}
  <div style={{ gridColumn: 'span M', height: '100%', minHeight: 0 }}>
    <div className="bg-slate-900 ... flex flex-col h-full">
      <div className="shrink-0"> {/* header */} </div>
      <div className="flex-1 overflow-y-auto no-scrollbar"> {/* content */} </div>
    </div>
  </div>

</div>
```

All tabs use a **12-column grid** just like the stream tab. Column splits vary per tab (e.g. 7+5, 6+6, 8+4).

---

## Sub-Tasks

---

### Sub-Task 1 — Remove shared `overflow-auto` wrapper + migrate each tab to its own absolute overlay

**Intent**  
The shared `overflow-auto` wrapper that wraps all non-stream tabs (lines 1728–1735 of `src/App.tsx`) must be removed. Each tab will instead get its own `position: absolute; inset: 0; overflow: hidden` div, following the exact same pattern as the Stream tab. This is the foundation — without it, no tab can fill the screen.

**Expected Outcomes**  
- The shared `<div className="absolute inset-0 overflow-auto p-6 bg-slate-950">` at line 1728 is removed
- Each tab (`alerts`, `permissions`, `music`, `tts`, `soundboard`, `mixer`, `timedmsg`, `schedule`, `hearts`, `gifts`) is wrapped in its own `position: absolute; inset: 0` div with visibility toggling
- All tabs render without scrolling the page — they fill the container exactly

**Todo List**  
1. Remove the opening tag `<div className="absolute inset-0 overflow-auto p-6 bg-slate-950" style={{ zIndex: 30, visibility: ..., pointerEvents: ... }}>` (lines 1728–1735)
2. Remove the corresponding closing `</div>` at line 3067
3. Add an individual wrapper div to each tab following the stream tab pattern — each div gets: `position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px', zIndex: 30, visibility: activeTab === 'X' ? 'visible' : 'hidden', pointerEvents: activeTab === 'X' ? 'auto' : 'none'`
4. Remove the old `max-w-3xl mx-auto` (or variant) wrapper from each tab's interior — the top-level layout is now the absolute container with padding

**Relevant Context**  
- Stream tab pattern: `src/App.tsx` lines 1666–1725 — copy the wrapper approach
- Shared wrapper to remove: `src/App.tsx` lines 1728–1735 (opening) and 3067 (closing)
- Each conditional `{activeTab === 'X' && (...)}` block becomes an unconditionally-rendered absolute overlay with visibility toggling (matching stream tab approach)

**Status** `[ ] pending`

---

### Sub-Task 2 — Layout: Automated Alerts tab (3-column grid)

**Intent**  
Three alert configs (Welcome, Gift, Follow) are equal in structure. At fullscreen they should fill the space side-by-side in 3 equal columns. Each column is its own full-height card with an internal scrollable body.

**Layout Plan**  
- Grid: `repeat(12, minmax(0, 1fr))` with 3 columns of `span 4` each
- Each column: `bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full`
- Each card: fixed header (`shrink-0`) containing alert title + toggle buttons, then scrollable body (`flex-1 overflow-y-auto no-scrollbar`) containing the template input, voice select, cooldown row
- Page title/reset button row: becomes a `shrink-0` header at the top of col 1, or a full-width row across all 3 columns (use `gridColumn: 'span 12'` for the header, then 3 cols below)

**Expected Outcomes**  
- 3 equal alert cards fill the screen side-by-side
- Each card scrolls internally only if content overflows

**Todo List**  
1. In `src/App.tsx`, find the `activeTab === 'alerts'` block (line 1738)
2. Wrap content in the absolute inset-0 overlay (from Sub-Task 1) with `display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px'`
3. Add a full-width header row (`gridColumn: 'span 12'`, `shrink-0`) containing the "Automated Engagement Alerts" title + "Reset Defaults" button
4. Place the Welcome Alert in col span 4, Gift Alert in col span 4, Follow Alert in col span 4
5. Each alert card: `bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col h-full shadow-xl`
6. Inside each alert card: header row (`shrink-0`) + body content (`flex-1 overflow-y-auto no-scrollbar p-1`)

**Relevant Context**  
- `src/App.tsx` lines 1738–2150 (`activeTab === 'alerts'`)
- Welcome Alert: lines 1783–1901, Gift Alert: lines 1903–2025, Follow Alert: lines 2027–2146

**Status** `[ ] pending`

---

### Sub-Task 3 — Layout: Command Permissions tab (single full-height scrollable card)

**Intent**  
Command Permissions is a list of 8 command rows. It should fill the screen as a single full-height card with a fixed header and a scrollable command list body.

**Layout Plan**  
- Single column filling full width (no grid needed — just `height: 100%`)
- Outer card: `bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full`
- Fixed header (`shrink-0`): title + reset button
- Scrollable body (`flex-1 overflow-y-auto no-scrollbar p-6 space-y-3`): command rows

**Expected Outcomes**  
- Command rows fill the available height — no empty space below
- List scrolls internally if there are many commands

**Todo List**  
1. In `src/App.tsx`, find the `activeTab === 'permissions'` block (line 2153)
2. Replace `max-w-3xl mx-auto space-y-6` wrapper with a `h-full flex flex-col` div
3. Move the card to fill `h-full` with `flex flex-col`
4. Split the card interior into `shrink-0` header + `flex-1 overflow-y-auto` command list

**Relevant Context**  
- `src/App.tsx` lines 2153–2254 (`activeTab === 'permissions'`)

**Status** `[ ] pending`

---

### Sub-Task 4 — Layout: Music Player & Queue tab (7+5 grid)

**Intent**  
Music Player has a player/queue section and a keyword blocker section. Split into a 7+5 grid: left = player header + now-playing + queue list (scrollable), right = keyword blocker card (full height).

**Layout Plan**  
- Grid: `repeat(12, minmax(0, 1fr))`, left = `span 7`, right = `span 5`
- Left column: card with `flex flex-col h-full` — fixed header (title + controls), fixed now-playing banner, scrollable queue list (`flex-1 overflow-y-auto`)
- Right column: card with `flex flex-col h-full` — keyword blocker header, input, scrollable keyword tags (`flex-1 overflow-y-auto`)

**Expected Outcomes**  
- Player and queue fill left side; keyword blocker fills right side
- Queue list scrolls internally when long

**Todo List**  
1. In `src/App.tsx`, find the `activeTab === 'music'` block (line 2257)
2. Replace outer `max-w-3xl mx-auto` wrapper with the absolute inset overlay + 12-col grid
3. Move music player card to left column (span 7): header+controls `shrink-0`, now-playing `shrink-0`, queue list `flex-1 overflow-y-auto`
4. Extract keyword blocker section (currently inside the same card, lines 2425–2502) into its own right column card (span 5) with its own header + input + keyword tags body

**Relevant Context**  
- `src/App.tsx` lines 2257–2505 (`activeTab === 'music'`)
- Keyword blocker section starts at line 2426 inside the same card

**Status** `[ ] pending`

---

### Sub-Task 5 — Layout: TTS Engine tab (6+6 grid)

**Intent**  
TTS Engine has a voice config section and a test+history section. Split into a 6+6 grid: left = voice selector config, right = test synthesis + TTS history (scrollable).

**Layout Plan**  
- Grid: `repeat(12, minmax(0, 1fr))`, left = `span 6`, right = `span 6`
- Left column: card `flex flex-col h-full` — header (title + enable/disable), voice filter input, voice select box, pitch/rate sliders
- Right column: card `flex flex-col h-full` — test synthesis block (`shrink-0`), TTS history list (`flex-1 overflow-y-auto`)

**Expected Outcomes**  
- Voice config fills left half; test + history fills right half, history scrolls internally

**Todo List**  
1. In `src/App.tsx`, find the `activeTab === 'tts'` block (line 2508)
2. Replace outer `max-w-3xl mx-auto` wrapper with the absolute inset overlay + 12-col grid
3. Left card (span 6): header + voice filter + voice select + sliders
4. Right card (span 6): test synthesis block + TTS history list (`flex-1 overflow-y-auto`)

**Relevant Context**  
- `src/App.tsx` lines 2508–2665 (`activeTab === 'tts'`)

**Status** `[ ] pending`

---

### Sub-Task 6 — Layout: Soundboard Keywords tab (full-width, scrollable)

**Intent**  
Soundboard has a dense trigger grid and a keyword blocker section. It should fill the full width as a single full-height card with an internally scrollable body.

**Layout Plan**  
- Single full-width column (`h-full flex flex-col`)
- Card: fixed header (`shrink-0`), scrollable interior (`flex-1 overflow-y-auto no-scrollbar`) containing trigger grid + keyword blocker

**Expected Outcomes**  
- Soundboard fills the full content area; trigger grid expands to fill the width; page does not scroll

**Todo List**  
1. In `src/App.tsx`, find the `activeTab === 'soundboard'` block (line 2668)
2. Replace `max-w-4xl mx-auto` wrapper with the absolute inset overlay
3. Single card fills `h-full` with `flex flex-col`
4. Card header `shrink-0`, body `flex-1 overflow-y-auto no-scrollbar`

**Relevant Context**  
- `src/App.tsx` lines 2668–2940 (`activeTab === 'soundboard'`)

**Status** `[ ] pending`

---

### Sub-Task 7 — Layout: Audio Mixer tab (6+6 grid)

**Intent**  
Audio Mixer is the sparsest tab — 3 sliders and a toggle. Split into 6+6: left = 3 channel sliders, right = settings (pause toggle + future settings).

**Layout Plan**  
- Grid: `repeat(12, minmax(0, 1fr))`, left = `span 6`, right = `span 6`
- Left card: `flex flex-col h-full` — header, 3-slider grid (each slider card takes equal space with `flex-1`)
- Right card: `flex flex-col h-full` — "Playback Settings" header, pause music toggle row

**Expected Outcomes**  
- No large empty space at the bottom of the tab; both columns are visible and balanced

**Todo List**  
1. In `src/App.tsx`, find the `activeTab === 'mixer'` block (line 2941)
2. Replace `max-w-3xl mx-auto` wrapper with the absolute inset overlay + 12-col grid
3. Left card (span 6): header + 3-channel sliders in a `flex flex-col gap-4 flex-1` layout so each slider card fills space proportionally
4. Right card (span 6): separate header + pause toggle extracted from the current card

**Relevant Context**  
- `src/App.tsx` lines 2941–3032 (`activeTab === 'mixer'`)

**Status** `[ ] pending`

---

### Sub-Task 8 — Layout: Timed Messages (component — 7+5 grid)

**Intent**  
`TimedMessagesPanel` renders the timed messages configuration. Split into 7+5: left = cooldown/interval config (fixed height), right = message list + add form (scrollable, fills height).

**Layout Plan**  
- The component is rendered via `<div style={{ display: activeTab === 'timedmsg' ? 'block' : 'none' }}>` in `src/App.tsx` (line 3055). This must be changed to match the absolute inset overlay pattern.
- The `src/App.tsx` wrapper for timedmsg changes to: `position: absolute, inset: 0, overflow: hidden, padding: 24px`
- Inside `TimedMessagesPanel`, replace `max-w-2xl mx-auto space-y-5` with a full-height 12-col grid layout
- Left (span 5): config card — header + cooldown mode selector + interval input, `shrink-0` (no flex-1 needed, fixed height content)
- Right (span 7): messages card — header + add-message input (`shrink-0`), message list (`flex-1 overflow-y-auto no-scrollbar`)

**Expected Outcomes**  
- Timed messages panel fills the screen; message list grows to fill remaining height

**Todo List**  
1. In `src/App.tsx` at line 3055, change `<div style={{ display: activeTab === 'timedmsg' ? 'block' : 'none' }}>` to the absolute inset overlay pattern with visibility toggling
2. In `src/components/TimedMessagesPanel.tsx` at line 196, replace `max-w-2xl mx-auto space-y-5` with a 12-col grid filling `h-full`
3. Left col (span 5): cooldown config card
4. Right col (span 7): messages card with `flex flex-col h-full` and scrollable list body

**Relevant Context**  
- `src/App.tsx` line 3055 (wrapper)
- `src/components/TimedMessagesPanel.tsx` line 196 (interior layout)

**Status** `[ ] pending`

---

### Sub-Task 9 — Layout: Stream Schedule (component — 5+7 grid)

**Intent**  
`ScheduleTab` has a next-stream banner + entry list on one side, and an add-entry form + announce settings on the other.

**Layout Plan**  
- Left (span 5): config card — header, next-stream banner (`shrink-0`), add-entry form (`shrink-0`)  
- Right (span 7): schedule list card — `flex flex-col h-full` with scrollable weekly entries list (`flex-1 overflow-y-auto`) + auto-announce settings at bottom (`shrink-0`)

**Expected Outcomes**  
- Schedule entry list fills the right column height; add-form is fixed on the left

**Todo List**  
1. In `src/App.tsx` at the `activeTab === 'schedule'` block (line 3035), change the `<ScheduleTab>` wrapper to the absolute inset overlay pattern
2. In `src/components/ScheduleTab.tsx` at line 85, replace `max-w-3xl mx-auto space-y-6` with a 12-col grid that fills `h-full`
3. The `ScheduleTab` component itself must receive `h-full` via either a passed class or by wrapping its root element

**Relevant Context**  
- `src/App.tsx` line 3035
- `src/components/ScheduleTab.tsx` line 85

**Status** `[ ] pending`

---

### Sub-Task 10 — Layout: Super Speed Hearts (component — 6+6 grid)

**Intent**  
`HeartsTab` has a controls card and a stats + explanation card. Split 6+6.

**Layout Plan**  
- Left (span 6): main control card — session URL status, burst interval, speed presets, start/stop buttons
- Right (span 6): live stats card (`shrink-0`) + "How it Works" explanation card (`flex-1` if small, or `shrink-0`)

**Expected Outcomes**  
- Controls on left, stats+info on right — no empty bottom half

**Todo List**  
1. In `src/App.tsx` at the `activeTab === 'hearts'` block (line 3043), change the `<HeartsTab>` wrapper to the absolute inset overlay pattern
2. In `src/components/HeartsTab.tsx` at line 73, replace `max-w-2xl mx-auto space-y-6` with a 12-col grid filling `h-full`
3. Left col (span 6): main control card; Right col (span 6): stats + how-it-works cards

**Relevant Context**  
- `src/App.tsx` line 3043
- `src/components/HeartsTab.tsx` line 73

**Status** `[ ] pending`

---

### Sub-Task 11 — Layout: Gift Previewer (component — 5+7 grid)

**Intent**  
`GiftPreviewerTab` has a gift catalogue (large card grid) and a live incoming gifts section. Split 5+7: catalogue on the left, incoming alerts on right.

**Layout Plan**  
- Left (span 5): catalogue controls + catalogue grid (`flex-1 overflow-y-auto`)
- Right (span 7): Live Gift Alerts card (`flex flex-col h-full`) — header (`shrink-0`), incoming gift list (`flex-1 overflow-y-auto`), empty state when no gifts

**Expected Outcomes**  
- Catalogue fills left column with internal scroll; incoming gifts fill the right column

**Todo List**  
1. In `src/App.tsx` at the `activeTab === 'gifts'` block (line 3048), change the `<GiftPreviewerTab>` wrapper to the absolute inset overlay pattern
2. In `src/components/GiftPreviewerTab.tsx` at line 135, replace `max-w-4xl mx-auto space-y-6` with a 12-col grid filling `h-full`
3. Left col (span 5): catalogue header + filter/sort controls (`shrink-0`), catalogue grid (`flex-1 overflow-y-auto no-scrollbar`)
4. Right col (span 7): Live Gift Alerts card, empty state placeholder when `incoming.length === 0`

**Relevant Context**  
- `src/App.tsx` line 3048
- `src/components/GiftPreviewerTab.tsx` line 135

**Status** `[ ] pending`

---

## Implementation Order

Sub-tasks must be done **in order** — Sub-Task 1 is foundational and must be done first. Sub-Tasks 2–11 can be done in any order after that, but each is self-contained.

After Sub-Task 1, the app will have all tabs rendering as empty full-bleed overlays (content will still show since it's inside). Sub-Tasks 2–11 each refactor the interior layout of one tab.
