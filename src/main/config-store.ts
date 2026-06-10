import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppSettings, RedisConnectionConfig, SavedConnections } from '../shared/types';
import { defaultLanguage, normalizeLanguage } from '../shared/i18n';

const configFileName = 'connection-config.json';
const defaultAppSettings: AppSettings = {
  keyListMode: 'raw',
  keyScanCount: 1000,
  themeMode: 'system',
  language: defaultLanguage
};

type StoredConfigData = SavedConnections & {
  settings?: Partial<AppSettings>;
};

type StoredConnectionConfig =
  | {
      version: 1;
      encrypted: true;
      data: string;
    }
  | {
      version: 1;
      encrypted: false;
      data: StoredConfigData;
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
    const existing = await this.loadStoredData().catch(() => undefined);
    const path = this.configPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(this.serializeConfig({ ...config, settings: existing?.settings }), null, 2), 'utf8');
  }

  async loadSettings(): Promise<AppSettings> {
    const stored = await this.loadStoredData().catch((error) => {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    });
    return normalizeAppSettings(stored?.settings);
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const existing = await this.loadStoredData().catch((error) => {
      if (isNotFoundError(error)) {
        return { connections: [] };
      }
      throw error;
    });
    const normalized = normalizeAppSettings(settings);
    const path = this.configPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(this.serializeConfig({ ...existing, settings: normalized }), null, 2), 'utf8');
    return normalized;
  }

  private configPath(): string {
    return join(app.getPath('userData'), configFileName);
  }

  private async loadStoredData(): Promise<StoredConfigData> {
    const content = await readFile(this.configPath(), 'utf8');
    return this.parseConfig(content);
  }

  private parseConfig(content: string): StoredConfigData {
    const parsed = JSON.parse(content) as StoredConnectionConfig | RedisConnectionConfig | SavedConnections;
    if (!('version' in parsed)) {
      return normalizeSavedConnections(parsed);
    }

    if (parsed.encrypted) {
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
      return normalizeSavedConnections(JSON.parse(decrypted) as StoredConfigData | RedisConnectionConfig);
    }

    return normalizeSavedConnections(parsed.data);
  }

  private serializeConfig(config: StoredConfigData): StoredConnectionConfig {
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

function normalizeSavedConnections(value: RedisConnectionConfig | StoredConfigData): StoredConfigData {
  if ('connections' in value) {
    return {
      selectedId: value.selectedId,
      connections: value.connections,
      settings: normalizeAppSettings(value.settings)
    };
  }

  const id = value.id ?? 'default';
  return {
    selectedId: id,
    connections: [{ ...value, id }],
    settings: defaultAppSettings
  };
}

function normalizeAppSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const count = Number(value?.keyScanCount);
  return {
    keyListMode: value?.keyListMode === 'tree' ? 'tree' : defaultAppSettings.keyListMode,
    keyScanCount: Number.isInteger(count) ? Math.min(10000, Math.max(10, count)) : defaultAppSettings.keyScanCount,
    themeMode: value?.themeMode === 'light' || value?.themeMode === 'dark' ? value.themeMode : defaultAppSettings.themeMode,
    language: normalizeLanguage(value?.language)
  };
}
