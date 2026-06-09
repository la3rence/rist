import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { ConfigStore } from './config-store';
import { RedisService } from './redis-service';
import { updateService } from './update-service';

export function registerIpc(): void {
  const configStore = new ConfigStore();
  const redis = new RedisService();

  ipcMain.handle('updates:getStatus', () => updateService.getStatus());
  ipcMain.handle('updates:check', () => updateService.checkForUpdates());
  ipcMain.handle('updates:install', () => updateService.installDownloadedUpdate());
  ipcMain.handle('config:loadConnections', () => configStore.loadConnections());
  ipcMain.handle('config:saveConnections', (_event, config) => configStore.saveConnections(config));
  ipcMain.handle('config:loadSettings', async () => {
    const settings = await configStore.loadSettings();
    nativeTheme.themeSource = settings.themeMode;
    return settings;
  });
  ipcMain.handle('config:saveSettings', async (_event, settings) => {
    const saved = await configStore.saveSettings(settings);
    nativeTheme.themeSource = saved.themeMode;
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('config:settingsChanged', saved);
      }
    });
    return saved;
  });
  ipcMain.handle('redis:connect', (_event, config) => redis.connect(config));
  ipcMain.handle('redis:testConnection', (_event, config) => redis.testConnection(config));
  ipcMain.handle('redis:disconnect', (_event, connectionId) => redis.disconnect(connectionId));
  ipcMain.handle('redis:scanKeys', (_event, request) => redis.scanKeys(request));
  ipcMain.handle('redis:previewKey', (_event, connectionId, key) => redis.previewKey(connectionId, key));
  ipcMain.handle('redis:deleteKey', (_event, connectionId, key) => redis.deleteKey(connectionId, key));
  ipcMain.handle('redis:setKey', (_event, request) => redis.setKey(request));
  ipcMain.handle('redis:setKeyTtl', (_event, request) => redis.setKeyTtl(request.connectionId, request.key, request.ttl));
  ipcMain.handle('redis:setHashField', (_event, request) => redis.setHashField(request.connectionId, request.key, request.field, request.value));
  ipcMain.handle('redis:runCommand', (_event, request) => redis.runCommand(request));
  ipcMain.handle('redis:ping', (_event, connectionId) => redis.ping(connectionId));
}
