const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  openMedia: () => ipcRenderer.invoke('media:open'),
  probe: (p) => ipcRenderer.invoke('media:probe', p),
  thumb: (p, t) => ipcRenderer.invoke('media:thumb', p, t),
  peaks: (p) => ipcRenderer.invoke('media:peaks', p),
  encoders: () => ipcRenderer.invoke('encoders:detect'),
  frame: (p, t) => ipcRenderer.invoke('media:frame', p, t),
  readTextFile: (exts) => ipcRenderer.invoke('file:readText', exts),
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (data, filePath) => ipcRenderer.invoke('project:save', { data, filePath }),
  openProject: () => ipcRenderer.invoke('project:open'),
  autosave: (data) => ipcRenderer.invoke('project:autosave', data),
  restore: () => ipcRenderer.invoke('project:restore'),
  pickExportPath: (ext) => ipcRenderer.invoke('export:pickPath', ext),
  startExport: (job) => ipcRenderer.invoke('export:start', job),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('export:progress', fn);
    return () => ipcRenderer.removeListener('export:progress', fn);
  },
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
});
