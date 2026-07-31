const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  createOrUpdateWebContentsView: (params) =>
    ipcRenderer.invoke('view:create-or-update', params),

  navigateWebContentsView: (params) =>
    ipcRenderer.invoke('view:navigate', params),

  destroyWebContentsView: (params) =>
    ipcRenderer.invoke('view:destroy', params),

  getMeetMeInitialUrl: () =>
    ipcRenderer.invoke('meetme:initial-url'),

  onViewRequestResize: (callback) => {
    const handler = () => {
      try { window.dispatchEvent(new CustomEvent('moodbot:view-resize')); } catch (_) {}
      callback();
    };
    ipcRenderer.on('view:request-resize', handler);
    return () => ipcRenderer.removeListener('view:request-resize', handler);
  },

});
