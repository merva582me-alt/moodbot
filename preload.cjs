const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── WebContentsView management ──────────────────────────────────────────────
  createOrUpdateWebContentsView: (params) =>
    ipcRenderer.invoke('view:create-or-update', params),

  navigateWebContentsView: (params) =>
    ipcRenderer.invoke('view:navigate', params),

  bringViewToFront: (params) =>
    ipcRenderer.invoke('view:bring-to-front', params),

  destroyWebContentsView: (params) =>
    ipcRenderer.invoke('view:destroy', params),

  onViewRequestResize: (callback) => {
    const handler = () => {
      try { window.dispatchEvent(new CustomEvent('moodbot:view-resize')); } catch (_) {}
      callback();
    };
    ipcRenderer.on('view:request-resize', handler);
    return () => ipcRenderer.removeListener('view:request-resize', handler);
  },

  // ── Bot connect / disconnect ────────────────────────────────────────────────
  connectBot: (params) =>
    ipcRenderer.invoke('bot:connect', params),

  disconnectBot: () =>
    ipcRenderer.invoke('bot:disconnect'),

  sendChatMessage: (text) =>
    ipcRenderer.invoke('bot:send-chat', text),

  // ── Live data subscriptions ─────────────────────────────────────────────────
  onMetricsUpdate: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('bot:metrics', handler);
    return () => ipcRenderer.removeListener('bot:metrics', handler);
  },

  onChatEvent: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('bot:chat-event', handler);
    return () => ipcRenderer.removeListener('bot:chat-event', handler);
  },

  onMeetMeChatMessage: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('meetme:chat-message', handler);
    return () => ipcRenderer.removeListener('meetme:chat-message', handler);
  },

  onYouTubeNowPlaying: (callback) => {
    const handler = (_e, title) => callback(title);
    ipcRenderer.on('youtube:now-playing', handler);
    return () => ipcRenderer.removeListener('youtube:now-playing', handler);
  },

  onYouTubeVideoEnded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('youtube:video-ended', handler);
    return () => ipcRenderer.removeListener('youtube:video-ended', handler);
  },

  onYouTubeVideoMetadata: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('youtube:video-metadata', handler);
    return () => ipcRenderer.removeListener('youtube:video-metadata', handler);
  },

  onYouTubeThumbnailUpdate: (callback) => {
    const handler = (_e, videoId) => callback(videoId);
    ipcRenderer.on('youtube:thumbnail-update', handler);
    return () => ipcRenderer.removeListener('youtube:thumbnail-update', handler);
  },

  onYouTubePlayState: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('youtube:play-state', handler);
    return () => ipcRenderer.removeListener('youtube:play-state', handler);
  },

  setYouTubeVolume: (volume) =>
    ipcRenderer.invoke('youtube:set-volume', { volume }),

  rampYouTubeVolume: (from, to, durationMs) =>
    ipcRenderer.invoke('youtube:ramp-volume', { from, to, durationMs }),

  pauseYouTube: () =>
    ipcRenderer.invoke('youtube:pause'),

  playYouTube: () =>
    ipcRenderer.invoke('youtube:play'),

  onScraperStatus: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('meetme:scraper-status', handler);
    return () => ipcRenderer.removeListener('meetme:scraper-status', handler);
  },

  // ── Edge TTS ──────────────────────────────────────────────────────────────
  ttsGetVoices: () =>
    ipcRenderer.invoke('tts:get-voices'),

  ttsSpeak: (payload) =>
    ipcRenderer.invoke('tts:speak', payload),

  // ── Gift Catalogue ─────────────────────────────────────────────────────────
  giftsGetCatalog: () =>
    ipcRenderer.invoke('gifts:get-catalog'),

  // ── Animation asset proxy (bypasses file:// cross-origin restriction) ──────
  fetchAnimationAsset: (url) =>
    ipcRenderer.invoke('assets:fetch', url),

  // ── Super Speed Hearts ─────────────────────────────────────────────────────
  heartsStart: (params) =>
    ipcRenderer.invoke('hearts:start', params ?? {}),

  heartsStop: () =>
    ipcRenderer.invoke('hearts:stop'),

  heartsStatus: () =>
    ipcRenderer.invoke('hearts:status'),

  onHeartsUpdate: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('hearts:update', handler);
    return () => ipcRenderer.removeListener('hearts:update', handler);
  },

  // ── License ───────────────────────────────────────────────────────────────
  /** Check if a valid encrypted key is already stored and validated. */
  licenseCheck: () =>
    ipcRenderer.invoke('license:check'),

  /** Activate a new key — binds HWID and saves encrypted to disk. */
  licenseActivate: (key) =>
    ipcRenderer.invoke('license:activate', { key }),

  /** Clear the stored key (de-register this machine). */
  licenseClear: () =>
    ipcRenderer.invoke('license:clear'),

  /** Get this machine's HWID. */
  licenseHwid: () =>
    ipcRenderer.invoke('license:hwid'),

  /** Called by main when a running license is revoked/paused mid-session. */
  onLicenseRevoked: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('license:revoked', handler);
    return () => ipcRenderer.removeListener('license:revoked', handler);
  },

  // ── Auto-updater ─────────────────────────────────────────────────────────
  /** Manually trigger an update check. */
  updaterCheck: () =>
    ipcRenderer.invoke('updater:check'),

  /** Quit and install the downloaded update. */
  updaterInstall: () =>
    ipcRenderer.invoke('updater:install'),

  /** Fires when an update is available: { version, releaseNotes } */
  onUpdaterAvailable: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('updater:available', handler);
    return () => ipcRenderer.removeListener('updater:available', handler);
  },

  /** Fires with download progress: { percent, bytesPerSecond, total, transferred } */
  onUpdaterProgress: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },

  /** Fires when update is fully downloaded and ready to install: { version } */
  onUpdaterDownloaded: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('updater:downloaded', handler);
    return () => ipcRenderer.removeListener('updater:downloaded', handler);
  },

});
