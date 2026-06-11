import { normalizeLanguage } from '../../../shared/i18n';
import type { AppSettings } from '../../../shared/types';
import { defaultSettings } from './constants';

export function normalizeAppSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const count = Number(value?.keyScanCount);
  return {
    keyListMode: value?.keyListMode === 'tree' ? 'tree' : defaultSettings.keyListMode,
    keyScanCount: Number.isInteger(count) ? Math.min(10000, Math.max(10, count)) : defaultSettings.keyScanCount,
    themeMode: value?.themeMode === 'light' || value?.themeMode === 'dark' ? value.themeMode : defaultSettings.themeMode,
    language: normalizeLanguage(value?.language)
  };
}
