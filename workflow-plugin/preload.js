'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['status', 'titleSources', 'search', 'select', 'platformLyrics', 'importFile', 'parsePaste', 'export', 'render']);
contextBridge.exposeInMainWorld('lyricsAPI', {
  command: (action, args = {}) => {
    if (!allowed.has(action)) return Promise.reject(new Error('不支持的操作'));
    return ipcRenderer.invoke('amll:command', action, args);
  },
});
