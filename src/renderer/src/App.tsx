import { CSSProperties, FormEvent, MouseEvent, ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeft, Plug, Server, Settings2, TerminalSquare } from 'lucide-react';
import type { AppSettings, ConnectionSummary, KeyPreview, KeySummary, RedisConnectionConfig, ScanKeysResult, SshTunnelConfig } from '../../shared/types';
import { translate } from '../../shared/i18n';
import { BrowserView } from './components/BrowserView';
import { ConnectionsView } from './components/ConnectionsView';
import { ConsoleView } from './components/ConsoleView';
import { SettingsWindowView } from './components/SettingsWindowView';
import { WindowTitleBar } from './components/WindowTitleBar';
import { useUpdateStatus } from './hooks/useUpdateStatus';
import { getRedisGuiApi } from './lib/api';
import { collapsedSidebarWidth, collapseThreshold, defaultSettings, defaultSshTunnel } from './lib/constants';
import { createConnectionConfig, normalizeConnectionConfig, normalizeSavedConnections } from './lib/connections';
import { createId } from './lib/ids';
import { createI18n, I18nContext } from './lib/i18n';
import {
  buildCreateKeyRequest,
  buildKeyTree,
  buildSetKeyRequest,
  createValueDraft,
  isEditableKeyType,
  mergeKeySummaries,
  normalizeScanPattern,
  parseTtlDraft,
  sortKeySummaries
} from './lib/keys';
import { normalizeAppSettings } from './lib/settings';
import type { ConsoleEntry, NewKeyDraft, SaveState, TestState, View } from './types';

const initialConfig = createConnectionConfig();

export default function App(): ReactElement {
  const windowName = new URLSearchParams(window.location.search).get('window');
  if (windowName === 'settings') {
    return <SettingsWindowView />;
  }
  return <MainApp />;
}

function MainApp(): ReactElement {
  const platform = window.redisGui?.platform ?? 'unknown';
  const { updateStatus, installUpdate } = useUpdateStatus();
  const [view, setView] = useState<View>('browser');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(236);
  const [configs, setConfigs] = useState<RedisConnectionConfig[]>([initialConfig]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>(initialConfig.id ?? '');
  const [connection, setConnection] = useState<ConnectionSummary | null>(null);
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [preview, setPreview] = useState<KeyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [valueDraft, setValueDraft] = useState('');
  const [ttlDraft, setTtlDraft] = useState('');
  const [valueEditError, setValueEditError] = useState('');
  const [savingValue, setSavingValue] = useState(false);
  const [ttlEditError, setTtlEditError] = useState('');
  const [savingTtl, setSavingTtl] = useState(false);
  const [pattern, setPattern] = useState('*');
  const [scanCursor, setScanCursor] = useState('0');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const i18n = useMemo(() => createI18n(settings.language), [settings.language]);
  const { t } = i18n;
  const [expandedKeyGroups, setExpandedKeyGroups] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState(() => translate(defaultSettings.language, 'ready'));
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [consoleCommand, setConsoleCommand] = useState('');
  const [consoleHistory, setConsoleHistory] = useState<ConsoleEntry[]>([]);
  const [batchSelectedKeys, setBatchSelectedKeys] = useState<Set<string>>(() => new Set());
  const scanRequestRef = useRef(0);

  const selectedConfig = useMemo(() => configs.find((item) => item.id === selectedConfigId) ?? configs[0], [configs, selectedConfigId]);
  const keyTree = useMemo(() => buildKeyTree(keys), [keys]);

  useEffect(() => {
    document.documentElement.lang = settings.language === 'en' ? 'en' : 'zh-CN';
  }, [settings.language]);

  useEffect(() => {
    let cancelled = false;

    async function loadConnections(): Promise<void> {
      try {
        const saved = await getRedisGuiApi().loadConnections();
        if (!cancelled && saved) {
          const normalized = normalizeSavedConnections(saved);
          setConfigs(normalized.connections);
          setSelectedConfigId(normalized.selectedId ?? normalized.connections[0]?.id ?? '');
          setStatus(t('loadedSavedConnections'));
          setSaveState('saved');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : t('unableToLoadSavedConnections'));
          setSaveState('error');
        }
      }
    }

    void loadConnections();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings(): Promise<void> {
      try {
        const loadedSettings = await getRedisGuiApi().loadSettings();
        if (!cancelled) {
          setSettings(normalizeAppSettings(loadedSettings));
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : translate(defaultSettings.language, 'unableToLoadSettings'));
        }
      }
    }

    void loadSettings();
    const unsubscribe = getRedisGuiApi().onSettingsChanged((nextSettings) => {
      setSettings(normalizeAppSettings(nextSettings));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!connection) return;
    const requestId = ++scanRequestRef.current;
    const timer = window.setTimeout(() => {
      void scanKeysFromStart(connection.id, requestId);
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [connection?.id, pattern, settings.keyScanCount]);

  useEffect(() => {
    function handleSettingsShortcut(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        void getRedisGuiApi().openSettings();
      }
    }

    window.addEventListener('keydown', handleSettingsShortcut, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleSettingsShortcut, { capture: true });
    };
  }, []);

  function updateSelectedConfig(patch: Partial<RedisConnectionConfig>): void {
    if (!selectedConfig) return;
    setConfigs((items) => items.map((item) => (item.id === selectedConfig.id ? normalizeConnectionConfig({ ...item, ...patch }) : item)));
    setSaveState('dirty');
    setTestState('idle');
    setTestMessage('');
  }

  function updateSshTunnel(patch: Partial<SshTunnelConfig>): void {
    if (!selectedConfig) return;
    updateSelectedConfig({
      sshTunnel: {
        ...defaultSshTunnel,
        ...selectedConfig.sshTunnel,
        ...patch
      }
    });
  }

  function addConnection(): void {
    const next = createConnectionConfig(`Redis ${configs.length + 1}`);
    setConfigs((items) => [...items, next]);
    setSelectedConfigId(next.id ?? '');
    setSaveState('dirty');
    setView('connections');
  }

  function duplicateConnection(): void {
    if (!selectedConfig) return;
    const next = normalizeConnectionConfig({
      ...selectedConfig,
      id: createId(),
      name: `${selectedConfig.name} Copy`
    });
    setConfigs((items) => [...items, next]);
    setSelectedConfigId(next.id ?? '');
    setSaveState('dirty');
    setView('connections');
  }

  function deleteConnectionConfig(): void {
    if (!selectedConfig || configs.length === 1) return;
    const confirmed = window.confirm(t('deleteConnectionConfirm', { name: selectedConfig.name }));
    if (!confirmed) return;

    const remaining = configs.filter((item) => item.id !== selectedConfig.id);
    setConfigs(remaining);
    setSelectedConfigId(remaining[0]?.id ?? '');
    setSaveState('dirty');
  }

  function selectConnectionConfig(id: string): void {
    setSelectedConfigId(id);
    setTestState('idle');
    setTestMessage('');
  }

  async function saveConnections(): Promise<void> {
    setSaveState('saving');
    try {
      await getRedisGuiApi().saveConnections({ selectedId: selectedConfigId, connections: configs });
      setSaveState('saved');
      setStatus(t('connectionsSaved'));
    } catch (error) {
      setSaveState('error');
      setStatus(error instanceof Error ? error.message : t('unableToSaveConnections'));
    }
  }

  async function connect(config = selectedConfig): Promise<void> {
    if (!config) return;
    if (config.id) {
      setSelectedConfigId(config.id);
    }
    setBusy(true);
    setStatus(t('connectingToRedis'));
    const previousConnection = connection;
    clearActiveConnectionState();
    try {
      const api = getRedisGuiApi();
      if (previousConnection) {
        await api.disconnect(previousConnection.id).catch(() => undefined);
      }
      const summary = await api.connect(config);
      setConnection(summary);
      setStatus(t('connectedTo', { name: summary.name }));
      setView('browser');
      const result = await scanKeysWithPattern(summary.id, pattern);
      if (!result) return;
      setKeys(sortKeySummaries(result.keys));
      setBatchSelectedKeys(new Set());
      setScanCursor(result.cursor);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('connectionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(config = selectedConfig): Promise<void> {
    if (!config) return;
    setTestState('testing');
    setTestMessage(t('testingConnection'));
    setStatus(t('testingConnection'));
    try {
      const summary = await getRedisGuiApi().testConnection(config);
      const detail = summary.redisVersion ? `Redis ${summary.redisVersion}` : summary.address;
      setTestState('success');
      setTestMessage(t('testPassedWithDetail', { detail }));
      setStatus(t('testPassedStatus', { name: summary.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('testFailed');
      setTestState('error');
      setTestMessage(message);
      setStatus(message);
    }
  }

  async function disconnect(): Promise<void> {
    if (!connection) return;
    setBusy(true);
    const previousConnection = connection;
    clearActiveConnectionState();
    try {
      await getRedisGuiApi().disconnect(previousConnection.id);
      setStatus(t('disconnected'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('disconnectFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!connection) return;
    setBusy(true);
    try {
      const result = await scanKeysWithPattern(connection.id, pattern);
      if (!result) return;
      setKeys(sortKeySummaries(result.keys));
      pruneBatchSelection(result.keys);
      setScanCursor(result.cursor);
      if (selectedKey) {
        await refreshSelectedPreview(connection.id, selectedKey);
      }
      setStatus(t('loadedKeys', { count: result.keys.length }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('scanFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function scanKeysFromStart(connectionId: string, requestId: number): Promise<void> {
    try {
      const result = await scanKeysWithPattern(connectionId, pattern, undefined, () => requestId === scanRequestRef.current);
      if (!result) return;
      setKeys(sortKeySummaries(result.keys));
      pruneBatchSelection(result.keys);
      setScanCursor(result.cursor);
      if (selectedKey && !result.keys.some((item) => item.key === selectedKey)) {
        setSelectedKey('');
        setPreview(null);
        setPreviewError('');
        setValueDraft('');
        setTtlDraft('');
        setValueEditError('');
      }
      setStatus(t('loadedKeys', { count: result.keys.length }));
    } catch (error) {
      if (requestId !== scanRequestRef.current) return;
      setStatus(error instanceof Error ? error.message : t('scanFailed'));
    }
  }

  async function loadMoreKeys(): Promise<void> {
    if (!connection || scanCursor === '0') return;
    setBusy(true);
    try {
      const result = await scanKeysWithPattern(connection.id, pattern, scanCursor);
      if (!result) return;
      setKeys((items) => sortKeySummaries(mergeKeySummaries(items, result.keys)));
      setScanCursor(result.cursor);
      setStatus(t('loadedMoreKeys', { count: result.keys.length }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('scanFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function scanKeysWithPattern(
    connectionId: string,
    rawPattern: string,
    cursor?: string,
    isCurrent?: () => boolean
  ): Promise<ScanKeysResult | null> {
    const normalizedPattern = normalizeScanPattern(rawPattern);
    const api = getRedisGuiApi();

    async function scanBatch(nextCursor?: string): Promise<ScanKeysResult | null> {
      if (isCurrent && !isCurrent()) return null;
      const result = await api.scanKeys({ connectionId, pattern: normalizedPattern, count: settings.keyScanCount, cursor: nextCursor });
      if (isCurrent && !isCurrent()) return null;
      return result;
    }

    const firstResult = await scanBatch(cursor);
    if (!firstResult || normalizedPattern === '*') {
      return firstResult;
    }

    let mergedKeys = firstResult.keys;
    let nextCursor = firstResult.cursor;
    while (nextCursor !== '0') {
      const nextResult = await scanBatch(nextCursor);
      if (!nextResult) return null;
      mergedKeys = mergeKeySummaries(mergedKeys, nextResult.keys);
      nextCursor = nextResult.cursor;
    }

    return { keys: mergedKeys, cursor: '0' };
  }

  function clearActiveConnectionState(): void {
    setConnection(null);
    setKeys([]);
    setSelectedKey('');
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError('');
    setValueDraft('');
    setTtlDraft('');
    setValueEditError('');
    setTtlEditError('');
    setSavingValue(false);
    setSavingTtl(false);
    setBatchSelectedKeys(new Set());
    setScanCursor('0');
    setConsoleCommand('');
  }

  async function selectKey(key: string): Promise<void> {
    if (!connection) return;
    setSelectedKey(key);
    setPreview(null);
    setPreviewError('');
    setValueDraft('');
    setTtlDraft('');
    setValueEditError('');
    setTtlEditError('');
    setPreviewLoading(true);
    setStatus(t('loadingPreview'));
    try {
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, key);
      syncPreviewDrafts(nextPreview);
      setStatus(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('previewFailed');
      setPreviewError(message);
      setStatus(message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function saveSelectedValue(): Promise<void> {
    if (!connection || !preview || !isEditableKeyType(preview.type)) return;
    setSavingValue(true);
    setValueEditError('');
    try {
      const request = buildSetKeyRequest(connection.id, preview, valueDraft, t);
      await getRedisGuiApi().setKey(request);
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, preview.key);
      syncPreviewDrafts(nextPreview);
      setKeys((items) => sortKeySummaries(items.map((item) => (item.key === nextPreview.key ? { ...item, type: nextPreview.type, ttl: nextPreview.ttl } : item))));
      setStatus(t('savedKey', { key: preview.key }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('saveFailed');
      setValueEditError(message);
      setStatus(message);
    } finally {
      setSavingValue(false);
    }
  }

  async function createKey(draft: NewKeyDraft): Promise<void> {
    if (!connection) return;
    setBusy(true);
    setValueEditError('');
    try {
      const request = buildCreateKeyRequest(connection.id, draft, t);
      await getRedisGuiApi().setKey(request);
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, request.key);
      syncPreviewDrafts(nextPreview);
      setSelectedKey(nextPreview.key);
      setKeys((items) =>
        sortKeySummaries(mergeKeySummaries(items, [{ key: nextPreview.key, type: nextPreview.type, ttl: nextPreview.ttl }]))
      );
      setStatus(t('createdKey', { key: nextPreview.key }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('createKeyFailed');
      setValueEditError(message);
      setStatus(message);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function saveHashField(field: string, value: string): Promise<void> {
    if (!connection || !preview || preview.type !== 'hash') return;
    setSavingValue(true);
    setValueEditError('');
    try {
      await getRedisGuiApi().setHashField({ connectionId: connection.id, key: preview.key, field, value });
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, preview.key);
      syncPreviewDrafts(nextPreview);
      setKeys((items) => sortKeySummaries(items.map((item) => (item.key === nextPreview.key ? { ...item, type: nextPreview.type, ttl: nextPreview.ttl } : item))));
      setStatus(t('savedHashField', { key: preview.key, field }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('hashFieldSaveFailed');
      setValueEditError(message);
      setStatus(message);
    } finally {
      setSavingValue(false);
    }
  }

  async function saveSelectedTtl(): Promise<void> {
    if (!connection || !preview) return;
    setSavingTtl(true);
    setTtlEditError('');
    try {
      const ttl = parseTtlDraft(ttlDraft, t);
      await getRedisGuiApi().setKeyTtl({ connectionId: connection.id, key: preview.key, ttl });
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, preview.key);
      syncPreviewDrafts(nextPreview);
      setKeys((items) => sortKeySummaries(items.map((item) => (item.key === nextPreview.key ? { ...item, ttl: nextPreview.ttl } : item))));
      setStatus(t('savedTtlFor', { key: preview.key }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('ttlSaveFailed');
      setTtlEditError(message);
      setStatus(message);
    } finally {
      setSavingTtl(false);
    }
  }

  async function refreshSelectedPreview(connectionId: string, key: string): Promise<void> {
    try {
      const nextPreview = await getRedisGuiApi().previewKey(connectionId, key);
      if (nextPreview.type === 'none') {
        setSelectedKey('');
        setPreview(null);
      setPreviewError('');
      setValueDraft('');
      setTtlDraft('');
      setValueEditError('');
      setTtlEditError('');
      setBatchSelectedKeys((items) => {
        const next = new Set(items);
        next.delete(key);
        return next;
      });
      return;
      }
      syncPreviewDrafts(nextPreview);
      setPreviewError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('previewRefreshFailed');
      setPreviewError(message);
      setStatus(message);
    }
  }

  function syncPreviewDrafts(nextPreview: KeyPreview): void {
    setPreview(nextPreview);
    setValueDraft(createValueDraft(nextPreview));
    setTtlDraft(nextPreview.ttl > 0 ? String(nextPreview.ttl) : '');
  }

  async function deleteSelected(): Promise<void> {
    if (!connection || !selectedKey) return;
    await deleteKey(selectedKey);
  }

  async function deleteKey(key: string): Promise<void> {
    if (!connection) return;
    const confirmed = window.confirm(t('deleteKeyConfirm', { key }));
    if (!confirmed) return;
    try {
      await getRedisGuiApi().deleteKey(connection.id, key);
      setBatchSelectedKeys((items) => {
        const next = new Set(items);
        next.delete(key);
        return next;
      });
      if (selectedKey === key) {
        setPreview(null);
        setPreviewLoading(false);
        setPreviewError('');
        setValueDraft('');
        setTtlDraft('');
        setValueEditError('');
        setTtlEditError('');
        setSelectedKey('');
      }
      setStatus(t('deletedKey', { key }));
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('deleteFailed'));
    }
  }

  async function deleteBatchSelected(): Promise<void> {
    if (!connection || batchSelectedKeys.size === 0) return;
    const keysToDelete = Array.from(batchSelectedKeys);
    const confirmed = window.confirm(t('deleteSelectedKeysConfirm', { count: keysToDelete.length }));
    if (!confirmed) return;

    setBusy(true);
    try {
      await Promise.all(keysToDelete.map((key) => getRedisGuiApi().deleteKey(connection.id, key)));
      if (selectedKey && batchSelectedKeys.has(selectedKey)) {
        setSelectedKey('');
        setPreview(null);
        setPreviewLoading(false);
        setPreviewError('');
        setValueDraft('');
        setTtlDraft('');
        setValueEditError('');
        setTtlEditError('');
      }
      setBatchSelectedKeys(new Set());
      setStatus(t('deletedKeys', { count: keysToDelete.length }));
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('batchDeleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  function toggleBatchKey(key: string): void {
    setBatchSelectedKeys((items) => {
      const next = new Set(items);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function addBatchKey(key: string): void {
    setBatchSelectedKeys((items) => {
      if (items.has(key)) return items;
      const next = new Set(items);
      next.add(key);
      return next;
    });
  }

  function clearBatchKeys(): void {
    setBatchSelectedKeys(new Set());
  }

  function selectBatchKeys(nextKeys: string[]): void {
    setBatchSelectedKeys(new Set(nextKeys));
  }

  function pruneBatchSelection(nextKeys: KeySummary[]): void {
    const available = new Set(nextKeys.map((item) => item.key));
    setBatchSelectedKeys((items) => new Set(Array.from(items).filter((key) => available.has(key))));
  }

  function toggleKeyGroup(id: string): void {
    setExpandedKeyGroups((items) => {
      const next = new Set(items);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function runConsoleCommand(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const command = consoleCommand.trim();
    if (!connection || !command) return;

    const entryId = createId();
    setConsoleCommand('');
    setConsoleHistory((items) => [...items, { id: entryId, command }]);

    try {
      const result = await getRedisGuiApi().runCommand({ connectionId: connection.id, command });
      setConsoleHistory((items) => items.map((item) => (item.id === entryId ? { ...item, result: result.value } : item)));
      setStatus(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('commandFailed');
      setConsoleHistory((items) => items.map((item) => (item.id === entryId ? { ...item, error: message } : item)));
      setStatus(message);
    }
  }

  function deleteConsoleEntry(id: string): void {
    const confirmed = window.confirm(t('deleteConsoleEntryConfirm'));
    if (!confirmed) return;
    setConsoleHistory((items) => items.filter((item) => item.id !== id));
  }

  function startSidebarResize(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarCollapsed ? collapsedSidebarWidth : sidebarWidth;
    const shell = event.currentTarget.closest('.app-shell') as HTMLElement | null;
    let latestWidth = startWidth;
    let latestCollapsed = sidebarCollapsed;

    shell?.classList.add('resizing-sidebar');

    function resize(moveEvent: globalThis.MouseEvent): void {
      const nextWidth = Math.min(320, Math.max(collapsedSidebarWidth, startWidth + moveEvent.clientX - startX));
      if (nextWidth < collapseThreshold) {
        latestCollapsed = true;
        shell?.classList.add('sidebar-collapsed');
        return;
      }
      latestCollapsed = false;
      latestWidth = nextWidth;
      shell?.classList.remove('sidebar-collapsed');
      shell?.style.setProperty('--sidebar-width', `${nextWidth}px`);
    }

    function stopResize(): void {
      shell?.classList.remove('resizing-sidebar');
      setSidebarCollapsed(latestCollapsed);
      if (!latestCollapsed) {
        setSidebarWidth(latestWidth);
      }
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResize);
    }

    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResize);
  }

  return (
    <I18nContext.Provider value={i18n}>
    <main className={`app-root platform-${platform} theme-${settings.themeMode}`}>
      <WindowTitleBar title="Rist" updateStatus={updateStatus} onInstallUpdate={() => void installUpdate()} />
      <section
        className={`${sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'} platform-${platform}`}
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <aside className="sidebar">
          <div className="window-drag" />
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} title={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}>
            <PanelLeft size={15} />
          </button>
          <div className="sidebar-top-spacer" />

          <section className="nav-list">
            <button className={view === 'connections' ? 'nav-item active' : 'nav-item'} onClick={() => setView('connections')} title={t('connections')}>
              <Settings2 size={16} />
              <span>{t('connections')}</span>
            </button>
            <button className={view === 'browser' ? 'nav-item active' : 'nav-item'} onClick={() => setView('browser')} title={t('browser')}>
              <Server size={16} />
              <span>{t('browser')}</span>
            </button>
            <button className={view === 'console' ? 'nav-item active' : 'nav-item'} onClick={() => setView('console')} title={t('console')}>
              <TerminalSquare size={16} />
              <span>{t('console')}</span>
            </button>
          </section>

          <section className="sidebar-status">
            {connection ? (
              <div className="active-profile" title={connection.name}>
                <span className="active-dot" />
                <span>{connection.name}</span>
              </div>
            ) : null}
            <button className="primary sidebar-connect" disabled={busy || !selectedConfig} onClick={connection ? disconnect : () => void connect()}>
              <Plug size={16} />
              {busy ? t('working') : connection ? t('disconnect') : t('connect')}
            </button>
          </section>
          <div className="sidebar-resizer" onMouseDown={startSidebarResize} />
        </aside>

        <section className="content">
          {view === 'browser' ? (
            <BrowserView
              busy={busy}
              connection={connection}
              expandedGroups={expandedKeyGroups}
              keyListMode={settings.keyListMode}
              keyTree={keyTree}
              keys={keys}
              keysLength={keys.length}
              pattern={pattern}
              preview={preview}
              previewError={previewError}
              previewLoading={previewLoading}
              savingValue={savingValue}
              savingTtl={savingTtl}
              scanCursor={scanCursor}
              selectedKey={selectedKey}
              batchSelectedKeys={batchSelectedKeys}
              ttlDraft={ttlDraft}
              valueDraft={valueDraft}
              valueEditError={valueEditError}
              ttlEditError={ttlEditError}
              onAddBatchKey={addBatchKey}
              onClearBatchKeys={clearBatchKeys}
              onDeleteSelected={() => void deleteSelected()}
              onDeleteKey={(key) => void deleteKey(key)}
              onDeleteBatchSelected={() => void deleteBatchSelected()}
              onLoadMore={() => void loadMoreKeys()}
              onPatternChange={setPattern}
              onRefresh={() => void refresh()}
              onCreateKey={(draft) => createKey(draft)}
              onSaveValue={() => void saveSelectedValue()}
              onSaveHashField={(field, value) => void saveHashField(field, value)}
              onSaveTtl={() => void saveSelectedTtl()}
              onSelectKey={(key) => void selectKey(key)}
              onSelectBatchKeys={selectBatchKeys}
              onToggleBatchKey={toggleBatchKey}
              onToggleGroup={toggleKeyGroup}
              onTtlDraftChange={setTtlDraft}
              onValueDraftChange={setValueDraft}
            />
          ) : null}

          {view === 'console' ? (
            <ConsoleView
              command={consoleCommand}
              connection={connection}
              history={consoleHistory}
              onCommandChange={setConsoleCommand}
              onDeleteEntry={deleteConsoleEntry}
              onRunCommand={(event) => void runConsoleCommand(event)}
            />
          ) : null}

          {view === 'connections' && selectedConfig ? (
            <ConnectionsView
              busy={busy}
              configs={configs}
              selectedConfig={selectedConfig}
              sshTunnel={selectedConfig.sshTunnel ?? defaultSshTunnel}
              onAdd={addConnection}
              onConnect={() => void connect()}
              onConnectConfig={(config) => void connect(config)}
              onDelete={deleteConnectionConfig}
              onDuplicate={duplicateConnection}
              onSave={() => void saveConnections()}
              onSelect={selectConnectionConfig}
              onTest={() => void testConnection()}
              onUpdate={updateSelectedConfig}
              onUpdateSsh={updateSshTunnel}
              saveState={saveState}
              testMessage={testMessage}
              testState={testState}
            />
          ) : null}

          <footer className="statusbar">
            <span>{connection ? `${connection.name} · ${connection.address}` : selectedConfig ? t('selectedProfile', { name: selectedConfig.name }) : t('noProfile')}</span>
            <span>{status}</span>
          </footer>
        </section>
      </section>
    </main>
    </I18nContext.Provider>
  );
}
