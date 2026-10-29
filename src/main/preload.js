'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const sub = (channel, cb) => {
  const h = (_e, d) => cb(d);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('kadr', {
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  importMedia: (paths) => ipcRenderer.invoke('media:import', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (data, path, saveAs) => ipcRenderer.invoke('project:save', { data, path, saveAs }),
  openProject: () => ipcRenderer.invoke('project:open'),
  startExport: (payload) => ipcRenderer.invoke('export:start', payload),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  onExportProgress: (cb) => sub('export:progress', cb),
  onExportDone: (cb) => sub('export:done', cb),
});
