const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let overlayWindow = null;
let tray = null;
const isDev = !app.isPackaged;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ProjectHub',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    if (app.quitting) return;
    e.preventDefault();
    mainWindow.hide();
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
  // Create a 16x16 blue circle icon programmatically
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA4ElEQVQ4T2NkoBAwUqifgWoGzP//n+E/AwMDIwMDgyMDA4ML' +
      'AwODDIwMDCwMjIyMFIwMjAyMDIwMDCwMjIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjA' +
      'yMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwM' +
      'jAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDI' +
      'wMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwMjAyMDIwNjAwMDA8AAAB' +
      'Ji0m9AAAAABJRU5ErkJggg==',
      'base64'
    )
  );

  // Fallback: create a simple icon from data URI
  const size = 16;
  const canvasIcon = nativeImage.createEmpty();

  tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x10,0x08,0x02,0x00,0x00,0x00,0x90,0x91,0x68,0x36,
      0x00,0x00,0x00,0x21,0x49,0x44,0x41,0x54,0x38,0x4f,0x63,0x24,0xd0,0x52,0x10,0x51,0x51,
      0x51,0x51,0x51,0x51,0x51,0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x10,
      0x10,0x10,0x00,0x00,0xe1,0x74,0x24,0x36,0x3e,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,
      0xae,0x42,0x60,0x82])
  ) : icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '📋 打开主窗口', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: '🔄 切换看板', click: () => { toggleOverlay(); } },
    { type: 'separator' },
    { label: '❌ 退出', click: () => { app.quitting = true; app.quit(); } }
  ]);

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

// IPC handlers
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
ipcMain.on('task-data-updated', () => {
  if (overlayWindow && overlayWindow.isVisible()) {
    overlayWindow.webContents.executeJavaScript('refreshTasks()');
  }
});

app.whenReady().then(() => {
  createMainWindow();
  createOverlayWindow();
  createTray();

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
  app.quitting = true;
});
