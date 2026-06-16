const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openTask: (taskId) => ipcRenderer.send('open-task', taskId),
  toggleAlwaysOnTop: (pinned) => ipcRenderer.send('toggle-always-on-top', pinned),
  toggleOverlay: () => ipcRenderer.invoke('toggle-overlay'),
  showMainWindow: () => ipcRenderer.send('show-main-window'),
  taskDataUpdated: (jsonData) => ipcRenderer.send('task-data-updated', jsonData),
  onTaskDataChanged: (callback) => ipcRenderer.on('task-data-changed', (_, data) => callback(data)),
  markTaskDone: (taskId) => ipcRenderer.invoke('mark-task-done', taskId),
  // Backup / Restore
  backupToOnedrive: () => ipcRenderer.invoke('backup-to-onedrive'),
  restoreFromOnedrive: () => ipcRenderer.invoke('restore-from-onedrive'),
  getBackupStatus: () => ipcRenderer.invoke('get-backup-status'),
});
