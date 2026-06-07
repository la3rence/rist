import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RedisConnectionConfig, SavedConnections } from '../shared/types';

const configFileName = 'connection-config.json';

type StoredConnectionConfig =
  | {
      version: 1;
      encrypted: true;
      data: string;
    }
  | {
      version: 1;
      encrypted: false;
      data: SavedConnections;
    };

export class ConfigStore {
  async loadConnections(): Promise<SavedConnections | undefined> {
    try {
      const content = await readFile(this.configPath(), 'utf8');
      return this.parseConfig(content);
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async saveConnections(config: SavedConnections): Promise<void> {
    const path = this.configPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(this.serializeConfig(config), null, 2), 'utf8');
  }

  private configPath(): string {
    return join(app.getPath('userData'), configFileName);
  }

  private parseConfig(content: string): SavedConnections {
    const parsed = JSON.parse(content) as StoredConnectionConfig | RedisConnectionConfig | SavedConnections;
    if (!('version' in parsed)) {
      return normalizeSavedConnections(parsed);
    }

    if (parsed.encrypted) {
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
      return normalizeSavedConnections(JSON.parse(decrypted) as SavedConnections | RedisConnectionConfig);
    }

    return normalizeSavedConnections(parsed.data);
  }

  private serializeConfig(config: SavedConnections): StoredConnectionConfig {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        version: 1,
        encrypted: true,
        data: safeStorage.encryptString(JSON.stringify(config)).toString('base64')
      };
    }

    return {
      version: 1,
      encrypted: false,
      data: config
    };
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function normalizeSavedConnections(value: RedisConnectionConfig | SavedConnections): SavedConnections {
  if ('connections' in value) {
    return {
      selectedId: value.selectedId,
      connections: value.connections
    };
  }

  const id = value.id ?? 'default';
  return {
    selectedId: id,
    connections: [{ ...value, id }]
  };
}
