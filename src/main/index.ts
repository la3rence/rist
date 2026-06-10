import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import { registerIpc } from './ipc';
import { updateService } from './update-service';
import { ConfigStore } from './config-store';
import { defaultLanguage, normalizeLanguage, translate } from '../shared/i18n';
import type { AppLanguage, TranslationKey } from '../shared/i18n';

let appLanguage: AppLanguage = defaultLanguage;

registerIpc((settings) => {
  createApplicationMenu(settings.language);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setTitle(translate(appLanguage, 'settings'));
  }
});

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
    title: translate(appLanguage, 'settings'),
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

function createApplicationMenu(language: AppLanguage = appLanguage): void {
  appLanguage = normalizeLanguage(language);
  const t = (key: TranslationKey): string => translate(appLanguage, key);
  const isMac = process.platform === 'darwin';
  const settingsMenuItem: MenuItemConstructorOptions = {
    label: t('settings'),
    accelerator: 'CmdOrCtrl+,',
    click: () => openSettingsWindow()
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsMenuItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : [
          {
            label: t('file'),
            submenu: [settingsMenuItem, { type: 'separator' }, { role: 'quit' }]
          } satisfies MenuItemConstructorOptions
        ]),
    {
      label: t('edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? ([{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] as MenuItemConstructorOptions[]) : ([{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: t('view'),
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: t('window'),
      submenu: isMac ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [{ role: 'minimize' }, { role: 'close' }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('app:openSettings', () => {
  openSettingsWindow();
});

app.whenReady().then(async () => {
  const settings = await new ConfigStore().loadSettings().catch(() => undefined);
  createApplicationMenu(settings?.language ?? defaultLanguage);
  createWindow();
  updateService.start();
});

app.on('window-all-closed', () => {
  updateService.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
