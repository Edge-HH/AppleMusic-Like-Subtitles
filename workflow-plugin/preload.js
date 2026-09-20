'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['status', 'titleSources', 'search', 'select', 'platformLyrics', 'importFile', 'parsePaste', 'export', 'render']);
contextBridge.exposeInMainWorld('lyricsAPI', {
  onRenderProgress: handler => {
    if (typeof handler !== 'function') throw new TypeError('进度回调必须是函数');
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('amll:render-progress', listener);
    return () => ipcRenderer.removeListener('amll:render-progress', listener);
  },
  command: (action, args = {}) => {
    if (!allowed.has(action)) return Promise.reject(new Error('不支持的操作'));
    return ipcRenderer.invoke('amll:command', action, args);
  },
});
