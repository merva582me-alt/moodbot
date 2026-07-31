/**
 * Minimal preload for the MeetMe WebContentsView.
 *
 * Goals:
 *  1. Expose ONLY the sendMeetMeChat relay — nothing that fingerprints Electron.
 *  2. Delete / hide every global that reveals this is an Electron context so
 *     MeetMe's login flow doesn't detect the runtime and redirect to /get-started.
 *
 * What we intentionally do NOT expose:
 *  - window.electronAPI  (the full bridge used by the main renderer)
 *  - window.process      (Node.js process object)
 *  - window.require      (Node.js require)
 */
const { ipcRenderer, contextBridge } = require('electron');

// ── Relay chat messages from the MeetMe page to the main process ──────────────
contextBridge.exposeInMainWorld('__mmRelay', {
  sendChat: (data) => ipcRenderer.send('meetme-chat-message', data),
});

// ── Scrub Electron fingerprints from the page JS context ──────────────────────
// These run in the isolated world before the page's own scripts execute.
try { delete window.process;  } catch (_) {}
try { delete window.require;  } catch (_) {}
