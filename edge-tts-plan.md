# Plan: Replace Web Speech API with Edge TTS (300+ Neural Voices)

## Overview

Replace the browser's built-in Web Speech API with Microsoft's Edge TTS neural voice service via the `msedge-tts` npm package. Edge TTS provides 300+ high-quality neural voices across many languages for free, using the same service that powers Microsoft Edge's Read Aloud feature.

Since Electron's renderer process runs in a sandboxed browser context (no Node.js), all Edge TTS work happens in the **main process** (`main.js`) and is exposed to the renderer via IPC. Audio data is returned as an MP3 buffer, transferred to the renderer, and played through the existing Web Audio graph (preserving ducking, volume, and queue logic).

The pitch/rate sliders are retained and passed as SSML prosody parameters to Edge TTS.

---

## Sub-Tasks

---

### Sub-Task 1 — Install `msedge-tts` npm package

**Intent**: Add the Edge TTS Node.js client as a dependency.

**Expected Outcomes**:
- `msedge-tts` is listed in `package.json` dependencies.
- `npm install` completes without errors.

**Todo List**:
1. Run `npm install msedge-tts` in the project root.
2. Verify the package appears in `package.json` dependencies and `node_modules`.

**Relevant Context**:
- `package.json` — current dependencies at lines 54–67.
- Package homepage: https://www.npmjs.com/package/msedge-tts
- The package uses WebSocket + SSML to call `wss://speech.platform.bing.com` and returns MP3/audio chunks.
- No API key required — uses the same free service as Edge's Read Aloud.

**Status**: [ ] pending

---

### Sub-Task 2 — Add IPC handlers in `main.js` for voice list and synthesis

**Intent**: Expose two new IPC channels from the Electron main process:
1. `tts:get-voices` — fetches and caches the full list of 300+ Edge TTS voices.
2. `tts:speak` — synthesizes text + voice + rate + pitch into an MP3 buffer and returns it to the renderer.

**Expected Outcomes**:
- `ipcMain.handle('tts:get-voices', ...)` returns an array of voice objects `{ shortName, friendlyName, locale, gender }`.
- `ipcMain.handle('tts:speak', ...)` returns a `Buffer` (MP3 bytes) for the requested text/voice/rate/pitch.
- Voice list is cached in memory after the first fetch to avoid repeated network calls.
- Rate and pitch are applied via SSML `<prosody>` tags (Edge TTS accepts `+X%` / `-X%` format).

**Todo List**:
1. Import `MsEdgeTTS` and `OUTPUT_FORMAT` from `msedge-tts` at the top of `main.js`.
2. Add a module-level `edgeTtsVoiceCache` variable (null until first fetch).
3. Add `ipcMain.handle('tts:get-voices', ...)` that calls `MsEdgeTTS.getVoices()` and caches the result.
4. Add `ipcMain.handle('tts:speak', ...)` that:
   - Accepts `{ text, voiceShortName, rate, pitch }` as payload.
   - Creates a new `MsEdgeTTS` instance with `OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3`.
   - Converts the float rate (0.5–1.5) and pitch (0.5–1.5) to SSML `+X%` / `-X%` strings.
   - Calls `synthesize(text)` (or equivalent method) and collects the full audio buffer.
   - Returns the buffer to the renderer.

**Relevant Context**:
- `main.js` — IPC handlers start around line 435; add new handlers near the bottom of the file (before the `app.whenReady()` or at the end of the handler section).
- `msedge-tts` API: `new MsEdgeTTS()`, `.setMetadata(voice, format)`, `.toStream(text)` or `.toFile(text)` depending on version — verify from installed package README/types.
- SSML prosody rate mapping: 1.0 → `+0%`, 1.5 → `+50%`, 0.5 → `-50%`.
- SSML prosody pitch mapping: 1.0 → `+0Hz`, 1.2 → `+20Hz` (Edge TTS uses Hz for pitch, scale 0.5–1.5 → roughly -50Hz to +50Hz).

**Status**: [ ] pending

---

### Sub-Task 3 — Expose new IPC channels through `preload.cjs`

**Intent**: Add `ttsGetVoices` and `ttsSpeak` methods to the `window.electronAPI` object so the renderer can call the main-process handlers.

**Expected Outcomes**:
- `window.electronAPI.ttsGetVoices()` returns the array of Edge TTS voice objects.
- `window.electronAPI.ttsSpeak({ text, voiceShortName, rate, pitch })` returns an MP3 `ArrayBuffer`.

**Todo List**:
1. In `preload.cjs`, add `ttsGetVoices: () => ipcRenderer.invoke('tts:get-voices')` to the `contextBridge.exposeInMainWorld` object.
2. Add `ttsSpeak: (payload) => ipcRenderer.invoke('tts:speak', payload)`.
3. Add the corresponding TypeScript types to `src/types.ts` in the `Window` interface / `ElectronAPI` type so the renderer can call them without type errors.

**Relevant Context**:
- `preload.cjs` — `contextBridge.exposeInMainWorld('electronAPI', { ... })` block; add alongside existing `setYouTubeVolume`, `pauseYouTube`, etc.
- `src/types.ts` — `ElectronAPI` interface or `Window` augmentation; add `ttsGetVoices` and `ttsSpeak` method signatures.

**Status**: [ ] pending

---

### Sub-Task 4 — Update `audioEngine.ts` to play Edge TTS audio

**Intent**: Modify `speakTTS()` in `MoodBotAudioEngine` to call Edge TTS via IPC instead of Web Speech API. The returned MP3 buffer is decoded and played through the existing Web Audio `ttsGainNode`, preserving volume, ducking, and queue semantics.

**Expected Outcomes**:
- `speakTTS()` no longer calls `window.speechSynthesis`.
- Audio plays through the Web Audio graph (respecting `ttsVolume` via gain node).
- Audio ducking still activates and releases correctly around each utterance.
- The serial queue still prevents overlapping utterances.
- Pitch and rate values from `ttsConfig` are forwarded to the IPC call.

**Todo List**:
1. Remove the `SpeechSynthesisUtterance` creation and `window.speechSynthesis.speak()` call from `speakTTS()`.
2. Add async IPC call: `window.electronAPI.ttsSpeak({ text, voiceShortName: activeVoiceURI, rate: this.ttsConfig.rate, pitch: this.ttsConfig.pitch })`.
3. Decode the returned `ArrayBuffer` using `this.audioContext.decodeAudioData(buffer)`.
4. Create a `BufferSourceNode`, connect it to `ttsGainNode`, and play.
5. On source `onended`, call `releaseDucking()`, `onEndCallback?.()`, and `_drainTTSQueue()`.
6. On error, call `releaseDucking()` and `_drainTTSQueue()` to unblock the queue.
7. Keep `acquireDucking(60_000)` before playback starts (same as before).

**Relevant Context**:
- `src/lib/audioEngine.ts` — `speakTTS()` at lines 222–289; `_drainTTSQueue()` at lines 291–297; `ttsGainNode` at ~line 72.
- The audio context (`this.audioContext`) already exists and is used for music/SFX.
- `ttsGainNode.gain.value` is set by `updateMixerState()` — no changes needed there.
- `voiceURI` in `TTSConfig` is repurposed to store the Edge TTS `shortName` (e.g. `en-US-AriaNeural`).

**Status**: [ ] pending

---

### Sub-Task 5 — Update `src/App.tsx` voice selector to use Edge TTS voices

**Intent**: Replace the `window.speechSynthesis.getVoices()` call with an IPC fetch of Edge TTS voices. Update the voice dropdown in the TTS tab and the three per-alert dropdowns to display Edge TTS voice names.

**Expected Outcomes**:
- On app load, `availableVoices` is populated from `window.electronAPI.ttsGetVoices()`.
- The global voice dropdown shows 300+ Edge TTS voices grouped or filterable by language.
- Per-alert voice dropdowns (Welcome, Gift, Follow) show the same list.
- The default voice is set to `en-US-AriaNeural` if no saved voice exists.
- The `speechSynthesis` `useEffect` is removed.

**Todo List**:
1. Remove the `useEffect` that calls `window.speechSynthesis.getVoices()` (lines 368–381 in `App.tsx`).
2. Add a new `useEffect` (runs once on mount) that calls `window.electronAPI.ttsGetVoices()` and sets `availableVoices`.
3. Change the type of `availableVoices` from `SpeechSynthesisVoice[]` to a new `EdgeTTSVoice` interface (`{ shortName, friendlyName, locale, gender }`).
4. Update all four voice `<select>` dropdowns to use `v.shortName` as the option key/value and `v.friendlyName` as the label.
5. Update the default voice fallback: if no saved `voiceURI`, set to `en-US-AriaNeural`.
6. Add a language filter/search input above the global voice dropdown to help users find voices among 300+.

**Relevant Context**:
- `src/App.tsx` — voices `useEffect` at lines 368–381; global voice dropdown at lines 1930–1940; per-alert dropdowns at lines 1395–1449, 1538–1552, 1637–1650.
- `src/types.ts` — add `EdgeTTSVoice` interface.
- `availableVoices` state is declared around line ~100–120 in `App.tsx` as `SpeechSynthesisVoice[]`.

**Status**: [ ] pending

---

## Notes for Implementation

- `msedge-tts` makes HTTP/WebSocket calls to Microsoft's free Edge TTS endpoint — no API key needed.
- The `voiceURI` field in `TTSConfig` / `EngagementAlertConfig` is reused to store the Edge TTS `shortName`. No type changes needed — just semantics shift.
- The rate/pitch sliders (0.5–1.5) remain in the UI; their values are forwarded to the SSML prosody tag in the main process.
- The `SpeechSynthesisVoice` type usage in `App.tsx` should be removed or replaced with the new `EdgeTTSVoice` type.
- Existing localStorage keys (`meetme_tts_config`) remain unchanged — the saved `voiceURI` will now be an Edge TTS shortName.
