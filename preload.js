const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openTask: (taskId) => ipcRenderer.send('open-task', taskId),
  toggleAlwaysOnTop: (pinned) => ipcRenderer.send('toggle-always-on-top', pinned),
  toggleOverlay: () => ipcRenderer.invoke('toggle-overlay'),
  showMainWindow: () => ipcRenderer.send('show-main-window'),
  taskDataUpdated: () => ipcRenderer.send('task-data-updated'),
  onTaskDataChanged: (callback) => ipcRenderer.on('task-data-changed', (_, data) => callback(data))
});
