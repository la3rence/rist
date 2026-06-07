import { contextBridge, ipcRenderer } from 'electron';
import type { ConsoleCommandRequest, RedisConnectionConfig, RedisGuiApi, SavedConnections, ScanKeysRequest, SetKeyRequest } from '../shared/types';

const api: RedisGuiApi = {
  platform: process.platform,
  loadConnections: () => ipcRenderer.invoke('config:loadConnections'),
  saveConnections: (config: SavedConnections) => ipcRenderer.invoke('config:saveConnections', config),
  connect: (config: RedisConnectionConfig) => ipcRenderer.invoke('redis:connect', config),
  testConnection: (config: RedisConnectionConfig) => ipcRenderer.invoke('redis:testConnection', config),
  disconnect: (connectionId: string) => ipcRenderer.invoke('redis:disconnect', connectionId),
  scanKeys: (request: ScanKeysRequest) => ipcRenderer.invoke('redis:scanKeys', request),
  previewKey: (connectionId: string, key: string) => ipcRenderer.invoke('redis:previewKey', connectionId, key),
  deleteKey: (connectionId: string, key: string) => ipcRenderer.invoke('redis:deleteKey', connectionId, key),
  setKey: (request: SetKeyRequest) => ipcRenderer.invoke('redis:setKey', request),
  runCommand: (request: ConsoleCommandRequest) => ipcRenderer.invoke('redis:runCommand', request),
  ping: (connectionId: string) => ipcRenderer.invoke('redis:ping', connectionId)
};

contextBridge.exposeInMainWorld('redisGui', api);
