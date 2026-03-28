const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  listFiles: (opts) => ipcRenderer.invoke('files:list', opts),
  deleteFiles: (relativePaths) => ipcRenderer.invoke('files:delete', relativePaths),
  validatePath: (targetPath) => ipcRenderer.invoke('workspace:validatePath', targetPath),
});
