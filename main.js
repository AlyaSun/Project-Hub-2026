const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ============ Single Instance Lock ============
// Prevent multiple instances — if user double-clicks shortcut while app is running in tray,
// focus the existing window instead of launching a new process (which would have empty data)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running — quit this one immediately
  app.quit();
} else {
  app.on('second-instance', () => {
    // User tried to open a second instance — focus the existing window
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.unminimize();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let overlayWindow = null;
let tray = null;
const isDev = !app.isPackaged;

// ============ App Icon ============
// Valid PNG icons generated programmatically (blue circle with white "P")
function createAppIcon() {
  // 16x16 icon
  const icon16 = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAfklEQVR4nGNgoDWQiF9K' +
      'mob/OADQoDVA7EWUAUCFGBhJfAY+584gwgDshoCcB1OIxxvI2AvdgDVYbMKH16Ab8JJE' +
      'A14ia2bA4VdCGLsLiAyDl+hewBsGWMQxwsCLRAMwExUsHRDhBfyJiUDA4daM5p01sIC' +
      'F0sTlBSyG4ZUHAF3pdL9FtM1dAAAAAElFTkSuQmCC',
      'base64'
    )
  );
  // 32x32 icon (for high DPI)
  const icon32 = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABC0lEQVR4nO2XwQ3DIAxF' +
      'MwMnpAzXE9Pk2hWqjMQknKlRqUQpPxhwSA9F+qqUUPwSvo2zLP8xOPTtMTWYIhnSTrIk' +
      'R/Lx18br4b4SC+obRwQKupPWKwHeb8Z0B6c/b2BhKDB/6wp+sGArQBtENFJtwVYAz9qO' +
      'YJzE3dIArmrM6N6vBQfN+JEdR8EVeiJBAA/rRLr3vVvAVNkL+lXJZgDsCMBOArAIwE0' +
      'CcKXgS2nySQBBP/YGah4QTkPoAZgFwgAwC4brAHM+rAOwEgoD4I5Jg7NAEACfBRHg2tM' +
      'w94KwCfntmc46IgGA/rZMQO3BEwijCxWSqbGuOIFY8+xgSOa7IAOZ/2XEgJoW65TxBD' +
      'V9BOwwPhzrAAAAAElFTkSuQmCC',
      'base64'
    )
  );
  // Use 32x32 as the primary, Electron will scale down for tray
  if (!icon32.isEmpty()) return icon32;
  if (!icon16.isEmpty()) return icon16;
  // Ultimate fallback
  return nativeImage.createEmpty();
}

// ============ OneDrive Auto-Backup ============
const BACKUP_FILENAME = 'projecthub-backup.json';
const BACKUP_HISTORY_DAYS = 7; // Keep 7 days of history

function getOneDrivePath() {
  const homeDir = os.homedir();
  // Try common OneDrive paths
  const candidates = [
    path.join(homeDir, 'OneDrive - IDG Inc'),
    path.join(homeDir, 'OneDrive'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getBackupDir() {
  const oneDrive = getOneDrivePath();
  if (!oneDrive) return null;
  const backupDir = path.join(oneDrive, 'ProjectHub-Backup');
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    return backupDir;
  } catch (e) {
    console.error('Failed to create backup dir:', e);
    return null;
  }
}

function backupToOnedrive(jsonData) {
  const backupDir = getBackupDir();
  if (!backupDir) return false;

  try {
    // 1. Save main backup (always overwritten with latest)
    const mainBackupPath = path.join(backupDir, BACKUP_FILENAME);
    const backupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks: JSON.parse(jsonData)
    };
    fs.writeFileSync(mainBackupPath, JSON.stringify(backupData, null, 2), 'utf8');

    // 2. Save dated backup (one per day, for history)
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const datedBackupPath = path.join(backupDir, `projecthub-backup-${dateStr}.json`);
    fs.writeFileSync(datedBackupPath, JSON.stringify(backupData, null, 2), 'utf8');

    // 3. Clean up old dated backups (keep only N days)
    const files = fs.readdirSync(backupDir);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - BACKUP_HISTORY_DAYS);
    for (const f of files) {
      if (f.startsWith('projecthub-backup-') && f.endsWith('.json')) {
        const filePath = path.join(backupDir, f);
        const stat = fs.statSync(filePath);
        if (stat.mtime < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    }

    return true;
  } catch (e) {
    console.error('Backup failed:', e);
    return false;
  }
}

function restoreFromOnedrive() {
  const backupDir = getBackupDir();
  if (!backupDir) return null;

  const mainBackupPath = path.join(backupDir, BACKUP_FILENAME);
  if (!fs.existsSync(mainBackupPath)) return null;

  try {
    const content = fs.readFileSync(mainBackupPath, 'utf8');
    const data = JSON.parse(content);
    return JSON.stringify(data.tasks);
  } catch (e) {
    console.error('Restore failed:', e);
    return null;
  }
}

// ============ Window Management ============

function createMainWindow() {
  const appIcon = createAppIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ProjectHub',
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  // Minimize to tray on close (instead of quitting)
  mainWindow.on('close', (e) => {
    if (app.quitting) return;
    e.preventDefault();
    mainWindow.hide();
    // Show a brief balloon tip the first time
    if (tray && !tray._balloonShown) {
      tray._balloonShown = true;
      tray.displayBalloon({
        title: 'ProjectHub',
        content: '应用已最小化到系统托盘，双击托盘图标可重新打开。右键可退出。'
      });
    }
  });

  // Hide overlay when main window is minimized
  mainWindow.on('minimize', () => {
    if (overlayWindow && overlayWindow.isVisible()) {
      overlayWindow.hide();
    }
  });
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 320,
    height: 520,
    x: screenWidth - 340,
    y: 60,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.setIgnoreMouseEvents(false);

  overlayWindow.on('close', (e) => {
    if (app.quitting) return;
    e.preventDefault();
    overlayWindow.hide();
  });
}

function createTray() {
  const icon = createAppIcon();

  const contextMenu = Menu.buildFromTemplate([
    { label: '📋 打开主窗口', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: '🔄 切换看板', click: () => { toggleOverlay(); } },
    { type: 'separator' },
    { label: '☁️ 备份到 OneDrive', click: () => { manualBackup(); } },
    { label: '📥 从 OneDrive 恢复', click: () => { manualRestore(); } },
    { type: 'separator' },
    { label: '❌ 退出', click: () => { app.quitting = true; app.quit(); } }
  ]);

  tray = new Tray(icon);
  tray.setToolTip('ProjectHub');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function toggleOverlay() {
  if (!overlayWindow) return;
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    overlayWindow.show();
  }
}

// ============ Manual Backup/Restore ============

async function manualBackup() {
  if (!mainWindow) return;
  try {
    const jsonData = await mainWindow.webContents.executeJavaScript('JSON.stringify(JSON.parse(localStorage.getItem("projecthub_tasks") || "[]"))');
    const success = backupToOnedrive(jsonData);
    if (success) {
      const backupDir = getBackupDir();
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '备份成功',
        message: `数据已成功备份到 OneDrive！\n\n路径：${backupDir}`,
        buttons: ['好的']
      });
    } else {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '备份失败',
        message: '无法备份到 OneDrive。请确认 OneDrive 目录存在且可写。',
        buttons: ['好的']
      });
    }
  } catch (e) {
    console.error('Manual backup error:', e);
  }
}

async function manualRestore() {
  if (!mainWindow) return;
  const restoredData = restoreFromOnedrive();
  if (!restoredData) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '恢复失败',
      message: 'OneDrive 中没有找到备份数据。',
      buttons: ['好的']
    });
    return;
  }

  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    title: '确认恢复',
    message: '确定要从 OneDrive 备份恢复数据吗？\n\n⚠️ 这将覆盖当前的所有任务数据！',
    buttons: ['取消', '恢复'],
    defaultId: 0,
    cancelId: 0
  });

  if (choice === 1) {
    mainWindow.webContents.executeJavaScript(`localStorage.setItem('projecthub_tasks', '${restoredData.replace(/'/g, "\\'")}'); location.reload();`);
  }
}

// ============ IPC handlers ============

ipcMain.handle('toggle-overlay', () => { toggleOverlay(); });

ipcMain.on('open-task', (_event, taskId) => {
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.executeJavaScript(`openDetail('${taskId}')`);
});

ipcMain.on('toggle-always-on-top', (_event, pinned) => {
  if (overlayWindow) {
    overlayWindow.setAlwaysOnTop(pinned);
  }
});

ipcMain.on('show-main-window', () => {
  mainWindow.show();
  mainWindow.focus();
});

// Sync localStorage between windows
ipcMain.on('task-data-updated', (_event, jsonData) => {
  if (overlayWindow && overlayWindow.isVisible()) {
    overlayWindow.webContents.executeJavaScript('refreshTasks()');
  }
  // Auto-backup to OneDrive on every data change
  if (jsonData) {
    backupToOnedrive(jsonData);
  }
});

// Backup/Restore IPC
ipcMain.handle('backup-to-onedrive', async () => {
  if (!mainWindow) return { success: false };
  try {
    const jsonData = await mainWindow.webContents.executeJavaScript('JSON.stringify(JSON.parse(localStorage.getItem("projecthub_tasks") || "[]"))');
    return { success: backupToOnedrive(jsonData), path: getBackupDir() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('restore-from-onedrive', async () => {
  return restoreFromOnedrive();
});

ipcMain.handle('get-backup-status', () => {
  const backupDir = getBackupDir();
  if (!backupDir) return { available: false };
  const mainBackup = path.join(backupDir, BACKUP_FILENAME);
  if (!fs.existsSync(mainBackup)) return { available: false, dir: backupDir };
  try {
    const stat = fs.statSync(mainBackup);
    const content = JSON.parse(fs.readFileSync(mainBackup, 'utf8'));
    return {
      available: true,
      dir: backupDir,
      lastBackup: stat.mtime.toISOString(),
      taskCount: content.tasks ? content.tasks.length : 0
    };
  } catch {
    return { available: false, dir: backupDir };
  }
});

// ============ App lifecycle ============

app.whenReady().then(() => {
  createMainWindow();
  createOverlayWindow();
  createTray();

  // Auto-restore from OneDrive on first launch if localStorage is empty
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      (async () => {
        const existing = localStorage.getItem('projecthub_tasks');
        if (!existing || existing === '[]' || existing === 'null') {
          // Try to restore from OneDrive
          if (window.electronAPI && window.electronAPI.restoreFromOnedrive) {
            const data = await window.electronAPI.restoreFromOnedrive();
            if (data) {
              localStorage.setItem('projecthub_tasks', data);
              location.reload();
            }
          }
        }
      })()
    `);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createOverlayWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep tray alive on Windows
});

app.on('before-quit', () => {
  // Final backup on quit
  if (mainWindow) {
    try {
      const jsonData = mainWindow.webContents.executeJavaScript('JSON.stringify(JSON.parse(localStorage.getItem("projecthub_tasks") || "[]"))');
      // Note: executeJavaScript is async, but we do best effort
    } catch (e) {}
  }
  app.quitting = true;
});
