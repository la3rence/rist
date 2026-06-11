import type { RedisConnectionConfig, SavedConnections } from '../../../shared/types';
import { defaultSshTunnel } from './constants';
import { createId } from './ids';

export function createConnectionConfig(name = 'Local Redis'): RedisConnectionConfig {
  return {
    id: createId(),
    name,
    mode: 'single',
    endpoints: [{ host: '127.0.0.1', port: 6379 }],
    database: 0,
    sshTunnel: defaultSshTunnel
  };
}

export function normalizeSavedConnections(saved: SavedConnections): SavedConnections {
  const connections = saved.connections.length > 0 ? saved.connections.map(normalizeConnectionConfig) : [createConnectionConfig()];
  const selectedId = saved.selectedId && connections.some((item) => item.id === saved.selectedId) ? saved.selectedId : connections[0].id;
  return { selectedId, connections };
}

export function normalizeConnectionConfig(config: RedisConnectionConfig): RedisConnectionConfig {
  return {
    ...config,
    id: config.id ?? createId(),
    name: config.name || 'Redis',
    mode: config.mode ?? 'single',
    endpoints: config.endpoints.length > 0 ? config.endpoints : [{ host: '127.0.0.1', port: 6379 }],
    sshTunnel: {
      ...defaultSshTunnel,
      ...config.sshTunnel
    }
  };
}
