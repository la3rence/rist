import { ReactElement, useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { AppSettings } from '../../../shared/types';
import { WindowTitleBar } from './WindowTitleBar';
import { useUpdateStatus } from '../hooks/useUpdateStatus';
import { getRedisGuiApi } from '../lib/api';
import { defaultSettings } from '../lib/constants';
import { formatUpdateDetail, formatUpdateStatus, updateActionLabel } from '../lib/format';
import { createI18n, I18nContext } from '../lib/i18n';
import { normalizeAppSettings } from '../lib/settings';
import type { SettingsTab } from '../types';

export function SettingsWindowView(): ReactElement {
  const platform = window.redisGui?.platform ?? 'unknown';
  const { updateStatus, checkForUpdates, installUpdate } = useUpdateStatus();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(defaultSettings);
  const i18n = useMemo(() => createI18n(settingsDraft.language), [settingsDraft.language]);
  const { t } = i18n;
  const [settingsError, setSettingsError] = useState('');

  useEffect(() => {
    function handleWindowShortcut(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleWindowShortcut, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleWindowShortcut, { capture: true });
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = settingsDraft.language === 'en' ? 'en' : 'zh-CN';
  }, [settingsDraft.language]);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings(): Promise<void> {
      try {
        const loadedSettings = await getRedisGuiApi().loadSettings();
        if (!cancelled) {
          setSettingsDraft(normalizeAppSettings(loadedSettings));
        }
      } catch (error) {
        if (!cancelled) {
          setSettingsError(error instanceof Error ? error.message : t('unableToLoadSettings'));
        }
      }
    }

    void loadSettings();
    const unsubscribe = getRedisGuiApi().onSettingsChanged((nextSettings) => {
      setSettingsDraft(normalizeAppSettings(nextSettings));
      setSettingsError('');
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  function updateSettingsDraft(patch: Partial<AppSettings>): void {
    const nextSettings = normalizeAppSettings({ ...settingsDraft, ...patch });
    setSettingsDraft(nextSettings);
    setSettingsError('');
    void saveSettings(nextSettings);
  }

  async function saveSettings(nextSettings: AppSettings): Promise<void> {
    try {
      const saved = await getRedisGuiApi().saveSettings(nextSettings);
      setSettingsDraft(normalizeAppSettings(saved));
      setSettingsError('');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : t('unableToSaveSettings'));
    }
  }

  const tabLabel = activeTab === 'general' ? t('general') : activeTab === 'query' ? t('query') : t('editor');

  return (
    <I18nContext.Provider value={i18n}>
    <main className={`settings-window platform-${platform} theme-${settingsDraft.themeMode}`}>
      <WindowTitleBar title={t('settings')} updateStatus={updateStatus} onInstallUpdate={() => void installUpdate()} />
      <section className="settings-dialog" aria-label={t('settingsAria')}>
        <div className="settings-layout">
          <nav className="settings-tabs" aria-label={t('settingsSections')}>
            <button className={activeTab === 'general' ? 'settings-tab active' : 'settings-tab'} onClick={() => setActiveTab('general')}>
              {t('general')}
            </button>
            <button className={activeTab === 'query' ? 'settings-tab active' : 'settings-tab'} onClick={() => setActiveTab('query')}>
              {t('query')}
            </button>
            <button className={activeTab === 'editor' ? 'settings-tab active' : 'settings-tab'} onClick={() => setActiveTab('editor')}>
              {t('editor')}
            </button>
          </nav>
          <section className="settings-panel">
            <h2>{tabLabel}</h2>
            {activeTab === 'general' ? (
              <div className="settings-section">
                <div className="settings-field">
                  <span>{t('theme')}</span>
                  <div className="settings-segmented theme-mode-control" role="group" aria-label={t('theme')}>
                    <button className={settingsDraft.themeMode === 'system' ? 'segmented active' : 'segmented'} onClick={() => updateSettingsDraft({ themeMode: 'system' })}>
                      {t('system')}
                    </button>
                    <button className={settingsDraft.themeMode === 'light' ? 'segmented active' : 'segmented'} onClick={() => updateSettingsDraft({ themeMode: 'light' })}>
                      {t('light')}
                    </button>
                    <button className={settingsDraft.themeMode === 'dark' ? 'segmented active' : 'segmented'} onClick={() => updateSettingsDraft({ themeMode: 'dark' })}>
                      {t('dark')}
                    </button>
                  </div>
                </div>
                <div className="settings-field">
                  <span>{t('language')}</span>
                  <div className="settings-segmented" role="group" aria-label={t('language')}>
                    <button className={settingsDraft.language === 'zh-CN' ? 'segmented active' : 'segmented'} onClick={() => updateSettingsDraft({ language: 'zh-CN' })}>
                      {t('simplifiedChinese')}
                    </button>
                    <button className={settingsDraft.language === 'en' ? 'segmented active' : 'segmented'} onClick={() => updateSettingsDraft({ language: 'en' })}>
                      {t('english')}
                    </button>
                  </div>
                </div>
                <div className="settings-field update-settings-field">
                  <span>{t('updates')}</span>
                  <div className="update-settings-control">
                    <div className="update-settings-copy">
                      <strong>{formatUpdateStatus(updateStatus, t)}</strong>
                      <span>{formatUpdateDetail(updateStatus, t)}</span>
                    </div>
                    <button
                      className={updateStatus.status === 'downloaded' ? 'primary compact-primary' : 'secondary compact-secondary'}
                      disabled={updateStatus.status === 'checking' || updateStatus.status === 'downloading' || updateStatus.status === 'installing' || updateStatus.status === 'disabled'}
                      onClick={updateStatus.status === 'downloaded' ? () => void installUpdate() : () => void checkForUpdates()}
                    >
                      <RefreshCcw size={14} />
                      {updateActionLabel(updateStatus, t)}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {activeTab === 'query' ? (
              <div className="settings-section">
                <div className="section-title">{t('keyBrowser')}</div>
                <div className="settings-field">
                  <span>{t('keyListMode')}</span>
                  <div className="settings-segmented" role="group" aria-label={t('keyListMode')}>
                    <button className={settingsDraft.keyListMode === 'raw' ? 'segmented active' : 'segmented'} onClick={() => updateSettingsDraft({ keyListMode: 'raw' })}>
                      Raw
                    </button>
                    <button className={settingsDraft.keyListMode === 'tree' ? 'segmented active' : 'segmented'} onClick={() => updateSettingsDraft({ keyListMode: 'tree' })}>
                      Prefix
                    </button>
                  </div>
                </div>
                <label>
                  {t('scanCount')}
                  <input
                    type="number"
                    min="10"
                    max="10000"
                    step="10"
                    value={settingsDraft.keyScanCount}
                    onChange={(event) => updateSettingsDraft({ keyScanCount: Number(event.target.value) || defaultSettings.keyScanCount })}
                  />
                </label>
              </div>
            ) : null}
            {activeTab === 'editor' ? <div className="settings-placeholder">{t('noSettings')}</div> : null}
            {settingsError ? <p className="settings-error">{settingsError}</p> : null}
          </section>
        </div>
      </section>
    </main>
    </I18nContext.Provider>
  );
}
