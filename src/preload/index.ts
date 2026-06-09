import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, ConsoleCommandRequest, RedisConnectionConfig, RedisGuiApi, SavedConnections, ScanKeysRequest, SetHashFieldRequest, SetKeyRequest, SetKeyTtlRequest, UpdateStatus } from '../shared/types';

const api: RedisGuiApi = {
  platform: process.platform,
  openSettings: () => ipcRenderer.invoke('app:openSettings'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:getStatus'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatusChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => listener(status);
    ipcRenderer.on('updates:statusChanged', handler);
    return () => ipcRenderer.removeListener('updates:statusChanged', handler);
  },
  loadConnections: () => ipcRenderer.invoke('config:loadConnections'),
  saveConnections: (config: SavedConnections) => ipcRenderer.invoke('config:saveConnections', config),
  loadSettings: () => ipcRenderer.invoke('config:loadSettings'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('config:saveSettings', settings),
  onSettingsChanged: (listener: (settings: AppSettings) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings): void => listener(settings);
    ipcRenderer.on('config:settingsChanged', handler);
    return () => ipcRenderer.removeListener('config:settingsChanged', handler);
  },
  connect: (config: RedisConnectionConfig) => ipcRenderer.invoke('redis:connect', config),
  testConnection: (config: RedisConnectionConfig) => ipcRenderer.invoke('redis:testConnection', config),
  disconnect: (connectionId: string) => ipcRenderer.invoke('redis:disconnect', connectionId),
  scanKeys: (request: ScanKeysRequest) => ipcRenderer.invoke('redis:scanKeys', request),
  previewKey: (connectionId: string, key: string) => ipcRenderer.invoke('redis:previewKey', connectionId, key),
  deleteKey: (connectionId: string, key: string) => ipcRenderer.invoke('redis:deleteKey', connectionId, key),
  setKey: (request: SetKeyRequest) => ipcRenderer.invoke('redis:setKey', request),
  setKeyTtl: (request: SetKeyTtlRequest) => ipcRenderer.invoke('redis:setKeyTtl', request),
  setHashField: (request: SetHashFieldRequest) => ipcRenderer.invoke('redis:setHashField', request),
  runCommand: (request: ConsoleCommandRequest) => ipcRenderer.invoke('redis:runCommand', request),
  ping: (connectionId: string) => ipcRenderer.invoke('redis:ping', connectionId)
};

contextBridge.exposeInMainWorld('redisGui', api);
