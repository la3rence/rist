import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import { registerIpc } from './ipc';

registerIpc();

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

function titleBarOverlayOptions(): Electron.TitleBarOverlay {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#e7edf5' : '#475569',
    height: 48
  };
}

function windowBackgroundColor(): string {
  return process.platform === 'win32' ? (nativeTheme.shouldUseDarkColors ? '#0c0f14' : '#f7f8fa') : '#00000000';
}

function syncNativeWindowAppearance(): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.setBackgroundColor(windowBackgroundColor());
      window.setTitleBarOverlay(titleBarOverlayOptions());
    }
  });
}

function loadRenderer(window: BrowserWindow, windowName?: string): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (windowName) {
      url.searchParams.set('window', windowName);
    }
    void window.loadURL(url.toString());
    return;
  }

  void window.loadFile(join(__dirname, '../renderer/index.html'), windowName ? { query: { window: windowName } } : undefined);
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 680,
    title: 'Rist',
    backgroundColor: windowBackgroundColor(),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 20, y: 20 } } : { titleBarOverlay: titleBarOverlayOptions() }),
    transparent: isMac,
    ...(isMac ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
    ...(isWindows ? { backgroundMaterial: 'none' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!isMac) {
    nativeTheme.on('updated', syncNativeWindowAppearance);
  }

  loadRenderer(mainWindow);
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.focus();
    return;
  }

  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  settingsWindow = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 520,
    minHeight: 380,
    title: '设置',
    parent: mainWindow ?? undefined,
    backgroundColor: windowBackgroundColor(),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 18 } } : { titleBarOverlay: titleBarOverlayOptions() }),
    transparent: isMac,
    ...(isMac ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
    ...(isWindows ? { backgroundMaterial: 'none' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  loadRenderer(settingsWindow, 'settings');
}

ipcMain.handle('app:openSettings', () => {
  openSettingsWindow();
});

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
