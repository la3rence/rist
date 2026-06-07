import { app, BrowserWindow, nativeTheme } from 'electron';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import { registerIpc } from './ipc';

registerIpc();

function titleBarOverlayOptions(): Electron.TitleBarOverlay {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#e7edf5' : '#475569',
    height: 48
  };
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 680,
    title: 'Rist',
    backgroundColor: '#00000000',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 20, y: 20 } } : { titleBarOverlay: titleBarOverlayOptions() }),
    transparent: true,
    ...(isMac ? { vibrancy: 'under-window', visualEffectState: 'active' as const } : {}),
    ...(isWindows ? { backgroundMaterial: 'acrylic' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!isMac) {
    nativeTheme.on('updated', () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.setTitleBarOverlay(titleBarOverlayOptions());
      }
    });
  }

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
