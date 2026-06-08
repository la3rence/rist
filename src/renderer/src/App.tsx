import {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  ChevronRight,
  Copy,
  Database,
  Eye,
  FileKey2,
  FlaskConical,
  Folder,
  KeyRound,
  LockKeyhole,
  PanelLeft,
  Pencil,
  Plug,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Server,
  Settings2,
  TerminalSquare,
  Trash2,
  X
} from 'lucide-react';
import type { ConnectionSummary, KeyPreview, KeySummary, RedisConnectionConfig, SavedConnections, ScanKeysResult, SetKeyRequest, SshTunnelConfig } from '../../shared/types';

type View = 'browser' | 'console' | 'connections';
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type TestState = 'idle' | 'testing' | 'success' | 'error';
type KeyListMode = 'raw' | 'tree';
type EditableKeyType = SetKeyRequest['type'];
type SettingsTab = 'general' | 'query' | 'editor';

type ConsoleEntry = {
  id: string;
  command: string;
  result?: unknown;
  error?: string;
};

type KeyTreeNode = {
  id: string;
  label: string;
  children: KeyTreeNode[];
  summary?: KeySummary;
};

const defaultSshTunnel: SshTunnelConfig = { enabled: false, host: '', port: 22, username: '' };
const connectionColors = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#64748b'];
const collapsedSidebarWidth = 88;
const collapseThreshold = 128;
const keyScanCount = 1000;

function createConnectionConfig(name = 'Local Redis'): RedisConnectionConfig {
  return {
    id: createId(),
    name,
    mode: 'single',
    endpoints: [{ host: '127.0.0.1', port: 6379 }],
    database: 0,
    sshTunnel: defaultSshTunnel
  };
}

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
  const [keyListMode, setKeyListMode] = useState<KeyListMode>('raw');
  const [expandedKeyGroups, setExpandedKeyGroups] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState('Ready');
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
    let cancelled = false;

    async function loadConnections(): Promise<void> {
      try {
        const saved = await getRedisGuiApi().loadConnections();
        if (!cancelled && saved) {
          const normalized = normalizeSavedConnections(saved);
          setConfigs(normalized.connections);
          setSelectedConfigId(normalized.selectedId ?? normalized.connections[0]?.id ?? '');
          setStatus('Loaded saved connections');
          setSaveState('saved');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Unable to load saved connections');
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
    if (!connection) return;
    const requestId = ++scanRequestRef.current;
    const timer = window.setTimeout(() => {
      void scanKeysFromStart(connection.id, requestId);
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [connection?.id, pattern]);

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
    const confirmed = window.confirm(`Delete connection "${selectedConfig.name}"?`);
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
      setStatus('Connections saved');
    } catch (error) {
      setSaveState('error');
      setStatus(error instanceof Error ? error.message : 'Unable to save connections');
    }
  }

  async function connect(config = selectedConfig): Promise<void> {
    if (!config) return;
    if (config.id) {
      setSelectedConfigId(config.id);
    }
    setBusy(true);
    setStatus('Connecting to Redis...');
    const previousConnection = connection;
    clearActiveConnectionState();
    try {
      const api = getRedisGuiApi();
      if (previousConnection) {
        await api.disconnect(previousConnection.id).catch(() => undefined);
      }
      const summary = await api.connect(config);
      setConnection(summary);
      setStatus(`Connected to ${summary.name}`);
      setView('browser');
      const result = await scanKeysWithPattern(summary.id, pattern);
      if (!result) return;
      setKeys(sortKeySummaries(result.keys));
      setBatchSelectedKeys(new Set());
      setScanCursor(result.cursor);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(config = selectedConfig): Promise<void> {
    if (!config) return;
    setTestState('testing');
    setTestMessage('Testing connection...');
    setStatus('Testing connection...');
    try {
      const summary = await getRedisGuiApi().testConnection(config);
      const detail = summary.redisVersion ? `Redis ${summary.redisVersion}` : summary.address;
      setTestState('success');
      setTestMessage(`Test passed · ${detail}`);
      setStatus(`Test passed: ${summary.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test failed';
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
      setStatus('Disconnected');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Disconnect failed');
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
      setStatus(`Loaded ${result.keys.length} keys`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Scan failed');
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
      setStatus(`Loaded ${result.keys.length} keys`);
    } catch (error) {
      if (requestId !== scanRequestRef.current) return;
      setStatus(error instanceof Error ? error.message : 'Scan failed');
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
      setStatus(`Loaded ${result.keys.length} more keys`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Scan failed');
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
      const result = await api.scanKeys({ connectionId, pattern: normalizedPattern, count: keyScanCount, cursor: nextCursor });
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
    setStatus('Loading preview');
    try {
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, key);
      syncPreviewDrafts(nextPreview);
      setStatus(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview failed';
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
      const request = buildSetKeyRequest(connection.id, preview, valueDraft);
      await getRedisGuiApi().setKey(request);
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, preview.key);
      syncPreviewDrafts(nextPreview);
      setKeys((items) => sortKeySummaries(items.map((item) => (item.key === nextPreview.key ? { ...item, type: nextPreview.type, ttl: nextPreview.ttl } : item))));
      setStatus(`Saved ${preview.key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      setValueEditError(message);
      setStatus(message);
    } finally {
      setSavingValue(false);
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
      setStatus(`Saved ${preview.key}:${field}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hash field save failed';
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
      const ttl = parseTtlDraft(ttlDraft);
      await getRedisGuiApi().setKeyTtl({ connectionId: connection.id, key: preview.key, ttl });
      const nextPreview = await getRedisGuiApi().previewKey(connection.id, preview.key);
      syncPreviewDrafts(nextPreview);
      setKeys((items) => sortKeySummaries(items.map((item) => (item.key === nextPreview.key ? { ...item, ttl: nextPreview.ttl } : item))));
      setStatus(`Saved TTL for ${preview.key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TTL save failed';
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
      const message = error instanceof Error ? error.message : 'Preview refresh failed';
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
    const confirmed = window.confirm(`Delete key "${key}"?`);
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
      setStatus(`Deleted ${key}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Delete failed');
    }
  }

  async function deleteBatchSelected(): Promise<void> {
    if (!connection || batchSelectedKeys.size === 0) return;
    const keysToDelete = Array.from(batchSelectedKeys);
    const confirmed = window.confirm(`Delete ${keysToDelete.length} selected keys?`);
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
      setStatus(`Deleted ${keysToDelete.length} keys`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Batch delete failed');
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
      const message = error instanceof Error ? error.message : 'Command failed';
      setConsoleHistory((items) => items.map((item) => (item.id === entryId ? { ...item, error: message } : item)));
      setStatus(message);
    }
  }

  function deleteConsoleEntry(id: string): void {
    const confirmed = window.confirm('Delete this console history entry?');
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
    <main className={`${sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'} platform-${platform}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <aside className="sidebar">
        <div className="window-drag" />
        <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <PanelLeft size={15} />
        </button>
        <div className="sidebar-top-spacer" />

        <section className="nav-list">
          <button className={view === 'browser' ? 'nav-item active' : 'nav-item'} onClick={() => setView('browser')} title="Browser">
            <Server size={16} />
            <span>Browser</span>
          </button>
          <button className={view === 'console' ? 'nav-item active' : 'nav-item'} onClick={() => setView('console')} title="Console">
            <TerminalSquare size={16} />
            <span>Console</span>
          </button>
          <button className={view === 'connections' ? 'nav-item active' : 'nav-item'} onClick={() => setView('connections')} title="Connections">
            <Settings2 size={16} />
            <span>Connections</span>
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
            {busy ? 'Working...' : connection ? 'Disconnect' : 'Connect'}
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
            keyListMode={keyListMode}
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
            onKeyListModeChange={setKeyListMode}
            onLoadMore={() => void loadMoreKeys()}
            onPatternChange={setPattern}
            onRefresh={() => void refresh()}
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
          <span>{connection ? `${connection.name} · ${connection.address}` : selectedConfig ? `Selected · ${selectedConfig.name}` : 'No profile'}</span>
          <span>{status}</span>
        </footer>
      </section>
    </main>
  );
}

function SettingsWindowView(): ReactElement {
  const platform = window.redisGui?.platform ?? 'unknown';
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

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

  const tabLabel = activeTab === 'general' ? '通用' : activeTab === 'query' ? '查询' : '编辑器';

  return (
    <main className={`settings-window platform-${platform}`}>
      <section className="settings-dialog" aria-label="设置">
        <header className="settings-header">
          <h1>设置</h1>
          <button className="icon-button" onClick={() => window.close()} title="Close settings">
            <X size={15} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="Settings sections">
            <button className={activeTab === 'general' ? 'settings-tab active' : 'settings-tab'} onClick={() => setActiveTab('general')}>
              通用
            </button>
            <button className={activeTab === 'query' ? 'settings-tab active' : 'settings-tab'} onClick={() => setActiveTab('query')}>
              查询
            </button>
            <button className={activeTab === 'editor' ? 'settings-tab active' : 'settings-tab'} onClick={() => setActiveTab('editor')}>
              编辑器
            </button>
          </nav>
          <section className="settings-panel">
            <h2>{tabLabel}</h2>
            <div className="settings-placeholder">暂无配置项</div>
          </section>
        </div>
      </section>
    </main>
  );
}

function BrowserView(props: {
  busy: boolean;
  connection: ConnectionSummary | null;
  batchSelectedKeys: Set<string>;
  expandedGroups: Set<string>;
  keyListMode: KeyListMode;
  keyTree: KeyTreeNode[];
  keys: KeySummary[];
  keysLength: number;
  pattern: string;
  preview: KeyPreview | null;
  previewError: string;
  previewLoading: boolean;
  savingValue: boolean;
  savingTtl: boolean;
  scanCursor: string;
  selectedKey: string;
  ttlDraft: string;
  valueDraft: string;
  valueEditError: string;
  ttlEditError: string;
  onAddBatchKey(key: string): void;
  onClearBatchKeys(): void;
  onDeleteBatchSelected(): void;
  onDeleteKey(key: string): void;
  onDeleteSelected(): void;
  onKeyListModeChange(mode: KeyListMode): void;
  onLoadMore(): void;
  onPatternChange(pattern: string): void;
  onRefresh(): void;
  onSaveHashField(field: string, value: string): void;
  onSaveValue(): void;
  onSaveTtl(): void;
  onSelectKey(key: string): void;
  onSelectBatchKeys(keys: string[]): void;
  onToggleBatchKey(key: string): void;
  onToggleGroup(id: string): void;
  onTtlDraftChange(ttl: string): void;
  onValueDraftChange(value: string): void;
}): ReactElement {
  const previewEditable = props.preview ? isEditableKeyType(props.preview.type) : false;
  const [valueEditing, setValueEditing] = useState(false);
  const [ttlEditing, setTtlEditing] = useState(false);
  const [batchDragging, setBatchDragging] = useState(false);
  const [keyPaneWidth, setKeyPaneWidth] = useState(360);
  const batchMode = props.batchSelectedKeys.size > 0;

  useEffect(() => {
    setValueEditing(false);
    setTtlEditing(false);
  }, [props.preview?.key]);

  useEffect(() => {
    if (!batchDragging) return;

    function stopBatchDrag(): void {
      setBatchDragging(false);
    }

    window.addEventListener('pointerup', stopBatchDrag);
    window.addEventListener('pointercancel', stopBatchDrag);
    return () => {
      window.removeEventListener('pointerup', stopBatchDrag);
      window.removeEventListener('pointercancel', stopBatchDrag);
    };
  }, [batchDragging]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      const element = target instanceof HTMLElement ? target : null;
      if (!element) return false;
      return Boolean(element.closest('input,textarea,[contenteditable="true"]'));
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      const key = event.key.toLowerCase();

      if (event.key === 'Escape' && ttlEditing) {
        event.preventDefault();
        setTtlEditing(false);
        if (props.preview) {
          props.onTtlDraftChange(props.preview.ttl > 0 ? String(props.preview.ttl) : '');
        }
        return;
      }

      if (event.key === 'Escape' && valueEditing) {
        event.preventDefault();
        setValueEditing(false);
        if (props.preview) {
          props.onValueDraftChange(createValueDraft(props.preview));
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === 'r') {
        if (!props.connection || props.busy) return;
        event.preventDefault();
        props.onRefresh();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === 'a') {
        if (isEditableTarget(event.target)) return;
        const element = event.target instanceof HTMLElement ? event.target : null;
        if (!element?.closest('.key-tree')) return;
        if (props.keys.length === 0) return;
        event.preventDefault();
        props.onSelectBatchKeys(props.keys.map((item) => item.key));
        return;
      }

      if (event.key === 'Escape' && batchMode) {
        event.preventDefault();
        props.onClearBatchKeys();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && batchMode) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        props.onDeleteBatchSelected();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && props.selectedKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        props.onDeleteSelected();
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [
    batchMode,
    props.keys,
    props.onClearBatchKeys,
    props.onDeleteBatchSelected,
    props.onDeleteSelected,
    props.onRefresh,
    props.onSelectBatchKeys,
    props.connection,
    props.busy,
    props.preview,
    props.onTtlDraftChange,
    props.onValueDraftChange,
    props.selectedKey,
    ttlEditing,
    valueEditing
  ]);

  function startKeyPaneResize(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = keyPaneWidth;
    const workspace = event.currentTarget.closest('.workspace') as HTMLElement | null;
    let latestWidth = startWidth;

    workspace?.classList.add('resizing-keys');

    function resize(moveEvent: globalThis.MouseEvent): void {
      const maxWidth = Math.max(260, (workspace?.clientWidth ?? 900) - 320);
      latestWidth = Math.min(maxWidth, Math.max(220, startWidth + moveEvent.clientX - startX));
      workspace?.style.setProperty('--key-pane-width', `${latestWidth}px`);
    }

    function stopResize(): void {
      workspace?.classList.remove('resizing-keys');
      setKeyPaneWidth(latestWidth);
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResize);
    }

    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResize);
  }

  return (
    <>
      <header className="toolbar">
        <div className="search">
          <Search size={16} />
          <input value={props.pattern} onChange={(event) => props.onPatternChange(event.target.value)} />
        </div>
        <div className="list-mode-toggle" role="group" aria-label="Key list mode">
          <button className={props.keyListMode === 'raw' ? 'segmented active' : 'segmented'} onClick={() => props.onKeyListModeChange('raw')}>
            Raw
          </button>
          <button className={props.keyListMode === 'tree' ? 'segmented active' : 'segmented'} onClick={() => props.onKeyListModeChange('tree')}>
            Prefix
          </button>
        </div>
        <button className="icon-button" disabled={!props.connection || props.busy} onClick={props.onRefresh} title="Refresh keys">
          <RefreshCcw size={16} />
        </button>
        {batchMode ? (
          <div className="batch-actions">
            <span>{props.batchSelectedKeys.size}</span>
            <button className="icon-button danger" disabled={props.busy} onClick={props.onDeleteBatchSelected} title="Delete selected keys">
              <Trash2 size={16} />
            </button>
            <button className="secondary compact-secondary" onClick={props.onClearBatchKeys}>
              Clear
            </button>
          </div>
        ) : null}
      </header>

      <section className="workspace" style={{ '--key-pane-width': `${keyPaneWidth}px` } as CSSProperties}>
        <section className="key-pane">
          <div className="pane-title">
            <KeyRound size={15} />
            Keys
            <span>{props.keysLength}</span>
          </div>
          <div
            className="key-tree"
            tabIndex={0}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement;
              if (!target.closest('button,input')) {
                event.currentTarget.focus({ preventScroll: true });
              }
            }}
          >
            {props.keyListMode === 'raw'
              ? props.keys.map((item) => (
                  <KeyRow
                    key={item.key}
                    batchMode={batchMode}
                    batchSelected={props.batchSelectedKeys.has(item.key)}
                    batchDragging={batchDragging}
                    depth={0}
                    item={item}
                    label={item.key}
                    selectedKey={props.selectedKey}
                    onAddBatchKey={props.onAddBatchKey}
                    onBeginBatchDrag={(key: string) => {
                      setBatchDragging(true);
                      props.onAddBatchKey(key);
                    }}
                    onDeleteKey={props.onDeleteKey}
                    onSelectKey={props.onSelectKey}
                    onToggleBatchKey={props.onToggleBatchKey}
                  />
                ))
              : props.keyTree.map((node) => (
                  <KeyTreeNodeView
                    key={node.id}
                    batchMode={batchMode}
                    batchSelectedKeys={props.batchSelectedKeys}
                    batchDragging={batchDragging}
                    depth={0}
                    expandedGroups={props.expandedGroups}
                    node={node}
                    selectedKey={props.selectedKey}
                    onAddBatchKey={props.onAddBatchKey}
                    onBeginBatchDrag={(key: string) => {
                      setBatchDragging(true);
                      props.onAddBatchKey(key);
                    }}
                    onDeleteKey={props.onDeleteKey}
                    onSelectKey={props.onSelectKey}
                    onToggleBatchKey={props.onToggleBatchKey}
                    onToggleGroup={props.onToggleGroup}
                  />
                ))}
            {props.connection && props.scanCursor !== '0' ? (
              <button className="load-more-keys" disabled={props.busy} onClick={props.onLoadMore}>
                Load more
              </button>
            ) : null}
          </div>
        </section>
        <div className="key-pane-resizer" onMouseDown={startKeyPaneResize} />

        <section className={props.preview ? 'preview-pane' : 'preview-pane empty-preview'}>
          {props.previewLoading ? (
            <div className="empty-state">
              <Database size={28} />
              <p>Loading value</p>
            </div>
          ) : props.previewError ? (
            <div className="empty-state error-state">
              <Database size={28} />
              <p>{props.previewError}</p>
            </div>
          ) : props.preview ? (
            <>
              <div className="preview-header">
                <div>
                  <h1>{props.preview.key}</h1>
                  <div className={ttlEditing ? 'preview-meta editing' : 'preview-meta'} onDoubleClick={() => setTtlEditing(true)} title="Double-click to edit TTL">
                    {ttlEditing ? (
                      <>
                        <span>{props.preview.type} · ttl</span>
                        <input type="number" min="1" value={props.ttlDraft} onChange={(event) => props.onTtlDraftChange(event.target.value)} placeholder="Persist" autoFocus />
                        <button
                          className="icon-button header-save-value"
                          disabled={props.savingTtl}
                          onClick={() => {
                            props.onSaveTtl();
                            setTtlEditing(false);
                          }}
                          title="Save TTL"
                        >
                          <Save size={15} />
                        </button>
                        {props.preview.size !== undefined ? <span>· {props.preview.size} items</span> : null}
                      </>
                    ) : (
                      <>
                        {props.preview.type} · ttl {props.preview.ttl}
                        {props.preview.size !== undefined ? ` · ${props.preview.size} items` : ''}
                      </>
                    )}
                  </div>
                </div>
                <div className="preview-actions">
                  {previewEditable ? (
                    <>
                      <button
                        className={valueEditing ? 'icon-button active' : 'icon-button'}
                        onClick={() => setValueEditing((value) => !value)}
                        title={valueEditing ? 'Preview value' : 'Edit value'}
                      >
                        {valueEditing ? <Eye size={15} /> : <Pencil size={15} />}
                      </button>
                      {valueEditing ? (
                        <button className="icon-button header-save-value" disabled={props.savingValue} onClick={props.onSaveValue} title="Save value">
                          <Save size={15} />
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  <button className="icon-button danger" onClick={props.onDeleteSelected} title="Delete selected key">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {props.ttlEditError ? <div className="header-edit-error">{props.ttlEditError}</div> : null}
              <div className="preview-body">
                <section className={valueEditing ? 'value-card editing' : 'value-card'}>
                  {valueEditing ? (
                    <textarea
                      className="value-editor-input"
                      value={props.valueDraft}
                      onChange={(event) => props.onValueDraftChange(event.target.value)}
                      spellCheck={false}
                    />
                  ) : (
                    <ValuePreviewContent
                      preview={props.preview}
                      savingValue={props.savingValue}
                      onSaveHashField={props.onSaveHashField}
                    />
                  )}
                  {props.valueEditError ? <p className="value-edit-error">{props.valueEditError}</p> : null}
                </section>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Database size={28} />
              <p>{props.connection ? 'No key selected' : 'No connection'}</p>
            </div>
          )}
        </section>
      </section>
    </>
  );
}

function ValuePreviewContent(props: {
  preview: KeyPreview;
  savingValue: boolean;
  onSaveHashField(field: string, value: string): void;
}): ReactElement {
  if (props.preview.type === 'hash') {
    return <HashPreviewTable preview={props.preview} savingValue={props.savingValue} onSaveHashField={props.onSaveHashField} />;
  }

  return <pre className="value-preview">{formatPreviewValue(props.preview.type, props.preview.value)}</pre>;
}

function HashPreviewTable(props: {
  preview: KeyPreview;
  savingValue: boolean;
  onSaveHashField(field: string, value: string): void;
}): ReactElement {
  const entries = getHashEntries(props.preview.value);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState('');
  const cancellingEdit = useRef(false);

  useEffect(() => {
    setEditingField(null);
    setFieldDraft('');
  }, [props.preview.key]);

  function beginFieldEdit(field: string, value: string): void {
    if (props.savingValue) return;
    cancellingEdit.current = false;
    setEditingField(field);
    setFieldDraft(value);
  }

  function commitFieldEdit(field: string): void {
    if (cancellingEdit.current) {
      cancellingEdit.current = false;
      return;
    }
    if (editingField !== field) return;
    const previousValue = entries.find(([itemField]) => itemField === field)?.[1] ?? '';
    const nextValue = fieldDraft;
    setEditingField(null);
    if (nextValue !== previousValue) {
      props.onSaveHashField(field, nextValue);
    }
  }

  function cancelFieldEdit(): void {
    cancellingEdit.current = true;
    setEditingField(null);
    setFieldDraft('');
  }

  function handleFieldKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, field: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelFieldEdit();
    }
  }

  if (entries.length === 0) {
    return <pre className="value-preview">(empty hash)</pre>;
  }

  return (
    <div className="hash-table" role="table" aria-label="Hash fields">
      <div className="hash-table-head" role="row">
        <div role="columnheader">Field</div>
        <div role="columnheader">Content</div>
      </div>
      {entries.map(([field, value]) => (
        <div className="hash-table-row" role="row" key={field}>
          <div className="hash-field" role="cell" title={field}>
            {field}
          </div>
          <div className="hash-content" role="cell" title={value} onDoubleClick={() => beginFieldEdit(field, value)}>
            {editingField === field ? (
              <input
                autoFocus
                className="hash-content-input"
                disabled={props.savingValue}
                value={fieldDraft}
                onBlur={() => commitFieldEdit(field)}
                onChange={(event) => setFieldDraft(event.target.value)}
                onKeyDown={(event) => handleFieldKeyDown(event, field)}
              />
            ) : (
              revealInvisibleText(value)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function KeyRow(props: {
  batchMode: boolean;
  batchSelected: boolean;
  batchDragging: boolean;
  depth: number;
  item: KeySummary;
  label: string;
  selectedKey: string;
  onAddBatchKey(key: string): void;
  onBeginBatchDrag(key: string): void;
  onDeleteKey(key: string): void;
  onSelectKey(key: string): void;
  onToggleBatchKey(key: string): void;
}): ReactElement {
  const pointerStart = useRef<{ x: number; y: number; swiping: boolean; selecting: boolean } | null>(null);
  const wheelSwipe = useRef<{ delta: number; timeout: number | null }>({ delta: 0, timeout: null });
  const [swiped, setSwiped] = useState(false);

  function startPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('button,input')) return;
    pointerStart.current = { x: event.clientX, y: event.clientY, swiping: false, selecting: false };
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = pointerStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!start.selecting && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.15) {
      start.selecting = true;
      props.onBeginBatchDrag(props.item.key);
      setSwiped(false);
      return;
    }

    if (!start.selecting && dx < -22 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      start.swiping = true;
      setSwiped(true);
    }
    if (!start.selecting && dx > 18) {
      setSwiped(false);
    }
  }

  function endPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.swiping || start.selecting || props.batchMode) return;
    props.onSelectKey(props.item.key);
  }

  function enterRow(): void {
    if (props.batchDragging) {
      props.onAddBatchKey(props.item.key);
    }
  }

  function wheelRow(event: ReactWheelEvent<HTMLDivElement>): void {
    if (props.batchMode) return;
    if (Math.abs(event.deltaX) < 3 || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.15) return;

    event.preventDefault();
    wheelSwipe.current.delta += event.deltaX;
    if (wheelSwipe.current.timeout !== null) {
      window.clearTimeout(wheelSwipe.current.timeout);
    }
    wheelSwipe.current.timeout = window.setTimeout(() => {
      wheelSwipe.current.delta = 0;
      wheelSwipe.current.timeout = null;
    }, 140);

    if (wheelSwipe.current.delta > 20) {
      setSwiped(true);
      wheelSwipe.current.delta = 0;
    }
    if (wheelSwipe.current.delta < -16) {
      setSwiped(false);
      wheelSwipe.current.delta = 0;
    }
  }

  return (
    <div
      className={swiped ? 'key-swipe open' : 'key-swipe'}
      onWheel={wheelRow}
      onPointerDown={startPointer}
      onPointerEnter={enterRow}
      onPointerMove={movePointer}
      onPointerUp={endPointer}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      style={{ '--key-depth': props.depth } as CSSProperties}
    >
      <button className="key-delete-action" onClick={() => props.onDeleteKey(props.item.key)} title="Delete key">
        Delete
      </button>
      <div className={props.selectedKey === props.item.key ? 'key-row selected' : 'key-row'}>
        {props.batchMode ? (
          <input
            aria-label={`Select ${props.item.key}`}
            checked={props.batchSelected}
            className="key-check"
            onChange={() => props.onToggleBatchKey(props.item.key)}
            type="checkbox"
          />
        ) : (
          <span className="key-check-spacer" />
        )}
        <span className="key-name" title={props.item.key}>
          {props.label}
        </span>
        <span className={`type-pill type-${props.item.type}`}>{props.item.type}</span>
      </div>
    </div>
  );
}

function KeyTreeNodeView(props: {
  batchMode: boolean;
  batchSelectedKeys: Set<string>;
  batchDragging: boolean;
  depth: number;
  expandedGroups: Set<string>;
  node: KeyTreeNode;
  selectedKey: string;
  onAddBatchKey(key: string): void;
  onBeginBatchDrag(key: string): void;
  onDeleteKey(key: string): void;
  onSelectKey(key: string): void;
  onToggleBatchKey(key: string): void;
  onToggleGroup(id: string): void;
}): ReactElement {
  if (props.node.summary) {
    return (
      <KeyRow
        batchMode={props.batchMode}
        batchSelected={props.batchSelectedKeys.has(props.node.summary.key)}
        batchDragging={props.batchDragging}
        depth={props.depth}
        item={props.node.summary}
        label={props.node.label}
        selectedKey={props.selectedKey}
        onAddBatchKey={props.onAddBatchKey}
        onBeginBatchDrag={props.onBeginBatchDrag}
        onDeleteKey={props.onDeleteKey}
        onSelectKey={props.onSelectKey}
        onToggleBatchKey={props.onToggleBatchKey}
      />
    );
  }

  const expanded = props.expandedGroups.has(props.node.id);
  return (
    <div className="key-group">
      <button className="key-group-row" onClick={() => props.onToggleGroup(props.node.id)} style={{ '--key-depth': props.depth } as CSSProperties}>
        <ChevronRight className={expanded ? 'chevron expanded' : 'chevron'} size={13} />
        <Folder size={13} />
        <span className="key-name" title={props.node.id}>
          {props.node.label}
        </span>
        <span className="group-count">{countLeafNodes(props.node)}</span>
      </button>
      {expanded ? (
        <div className="key-group-children">
          {props.node.children.map((child) => (
            <KeyTreeNodeView
              key={child.id}
              batchMode={props.batchMode}
              batchSelectedKeys={props.batchSelectedKeys}
              batchDragging={props.batchDragging}
              depth={props.depth + 1}
              expandedGroups={props.expandedGroups}
              node={child}
              selectedKey={props.selectedKey}
              onAddBatchKey={props.onAddBatchKey}
              onBeginBatchDrag={props.onBeginBatchDrag}
              onDeleteKey={props.onDeleteKey}
              onSelectKey={props.onSelectKey}
              onToggleBatchKey={props.onToggleBatchKey}
              onToggleGroup={props.onToggleGroup}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConsoleView(props: {
  command: string;
  connection: ConnectionSummary | null;
  history: ConsoleEntry[];
  onCommandChange(command: string): void;
  onDeleteEntry(id: string): void;
  onRunCommand(event: FormEvent<HTMLFormElement>): void;
}): ReactElement {
  const commandInput = useRef<HTMLInputElement>(null);
  const historyPane = useRef<HTMLDivElement>(null);
  const lastEntry = props.history[props.history.length - 1];

  useEffect(() => {
    const pane = historyPane.current;
    if (!pane) return;
    requestAnimationFrame(() => {
      pane.scrollTop = pane.scrollHeight;
    });
  }, [props.history.length, lastEntry?.result, lastEntry?.error, props.connection?.id]);

  return (
    <>
      <header className="toolbar console-toolbar">
        <div>
          <TerminalSquare size={16} />
          <span>{props.connection ? props.connection.name : 'Console'}</span>
        </div>
      </header>
      <section className="terminal-pane">
        <div className="terminal-history" ref={historyPane}>
          {props.history.length === 0 ? (
            <div className="empty-state">
              <TerminalSquare size={28} />
              <p>{props.connection ? 'Console ready' : 'No connection'}</p>
            </div>
          ) : (
            props.history.map((entry) => (
              <article className="console-entry" key={entry.id}>
                <div className="console-entry-head">
                  <div className="console-input">
                    <span>&gt;</span>
                    <code>{entry.command}</code>
                  </div>
                  <button className="console-delete" onClick={() => props.onDeleteEntry(entry.id)} title="Delete history entry">
                    <Trash2 size={13} />
                  </button>
                </div>
                <pre className={entry.error ? 'console-output error' : 'console-output'}>{entry.error ?? formatConsoleValue(entry.result)}</pre>
              </article>
            ))
          )}
        </div>
        <form
          className={props.connection ? 'terminal-command' : 'terminal-command disconnected'}
          onClick={() => commandInput.current?.focus()}
          onSubmit={props.onRunCommand}
          title={props.connection ? undefined : 'No active connection'}
        >
          <span className="terminal-prompt">redis&gt;</span>
          <input ref={commandInput} value={props.command} disabled={!props.connection} onChange={(event) => props.onCommandChange(event.target.value)} spellCheck={false} />
        </form>
      </section>
    </>
  );
}

function ConnectionsView(props: {
  busy: boolean;
  configs: RedisConnectionConfig[];
  selectedConfig: RedisConnectionConfig;
  sshTunnel: SshTunnelConfig;
  onAdd(): void;
  onConnect(): void;
  onConnectConfig(config: RedisConnectionConfig): void;
  onDelete(): void;
  onDuplicate(): void;
  onSave(): void;
  onSelect(id: string): void;
  onTest(): void;
  onUpdate(patch: Partial<RedisConnectionConfig>): void;
  onUpdateSsh(patch: Partial<SshTunnelConfig>): void;
  saveState: SaveState;
  testMessage: string;
  testState: TestState;
}): ReactElement {
  const endpoint = props.selectedConfig.endpoints[0] ?? { host: '127.0.0.1', port: 6379 };
  const endpoints = props.selectedConfig.endpoints.length > 0 ? props.selectedConfig.endpoints : [endpoint];
  const selectedColor = props.selectedConfig.color;
  const [profilesWidth, setProfilesWidth] = useState(280);

  function updateEndpoint(index: number, patch: Partial<(typeof endpoints)[number]>): void {
    const next = endpoints.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    props.onUpdate({ endpoints: next });
  }

  function addEndpoint(): void {
    props.onUpdate({ endpoints: [...endpoints, { host: '127.0.0.1', port: 6379 }] });
  }

  function removeEndpoint(index: number): void {
    const confirmed = window.confirm('Delete this endpoint?');
    if (!confirmed) return;
    const next = endpoints.filter((_item, itemIndex) => itemIndex !== index);
    props.onUpdate({ endpoints: next.length > 0 ? next : [{ host: '127.0.0.1', port: 6379 }] });
  }

  function startProfilesResize(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = profilesWidth;
    const workspace = event.currentTarget.closest('.connections-workspace') as HTMLElement | null;
    let latestWidth = startWidth;

    workspace?.classList.add('resizing-profiles');

    function resize(moveEvent: globalThis.MouseEvent): void {
      latestWidth = Math.min(420, Math.max(168, startWidth + moveEvent.clientX - startX));
      workspace?.style.setProperty('--profiles-width', `${latestWidth}px`);
    }

    function stopResize(): void {
      workspace?.classList.remove('resizing-profiles');
      setProfilesWidth(latestWidth);
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResize);
    }

    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResize);
  }

  return (
    <>
      <header className="toolbar page-toolbar">
        <div className="toolbar-title">
          <h1>Connections</h1>
          <span>{props.configs.length} profiles</span>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" onClick={props.onAdd} title="Add connection">
            <Plus size={16} />
          </button>
          <button className="icon-button" onClick={props.onDuplicate} title="Duplicate connection">
            <Copy size={16} />
          </button>
          <button className="icon-button danger" disabled={props.configs.length === 1} onClick={props.onDelete} title="Delete connection">
            <Trash2 size={16} />
          </button>
          <button className="primary compact-primary" disabled={props.busy} onClick={props.onConnect}>
            <Plug size={14} />
            Connect
          </button>
        </div>
      </header>

      <section className="connections-workspace" style={{ '--profiles-width': `${profilesWidth}px` } as CSSProperties}>
        <section className="profiles-pane">
          {props.configs.map((config) => {
            const first = config.endpoints[0];
            return (
              <button
                key={config.id}
                className={config.id === props.selectedConfig.id ? 'profile-row selected' : 'profile-row'}
                onClick={() => props.onSelect(config.id ?? '')}
                onDoubleClick={() => props.onConnectConfig(config)}
                title="Double-click to connect"
              >
                <span className={config.color ? 'profile-color' : 'profile-color empty'} style={{ background: config.color ?? 'transparent' }} />
                <span className="profile-main">
                  <span>{config.name}</span>
                  <small>{first ? `${first.host}:${first.port}` : 'No endpoint'}</small>
                </span>
              </button>
            );
          })}
        </section>
        <div className="profiles-resizer" onMouseDown={startProfilesResize} />

        <section className="connection-editor">
          <div className="form-section">
            <div className="section-title">
              <Database size={14} />
              Redis
            </div>
            <label>
              Name
              <input value={props.selectedConfig.name} onChange={(event) => props.onUpdate({ name: event.target.value })} />
            </label>
            <div className="color-field">
              <span>
                Profile Color
                <em>Optional</em>
              </span>
              <div className="color-swatches">
                <button className={!selectedColor ? 'color-none selected' : 'color-none'} onClick={() => props.onUpdate({ color: undefined })}>
                  None
                </button>
                {connectionColors.map((color) => (
                  <button
                    key={color}
                    className={color === selectedColor ? 'color-swatch selected' : 'color-swatch'}
                    onClick={() => props.onUpdate({ color })}
                    style={{ background: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
            <div className="row compact">
              <button className={props.selectedConfig.mode === 'single' ? 'segmented active' : 'segmented'} onClick={() => props.onUpdate({ mode: 'single' })}>
                Single
              </button>
              <button className={props.selectedConfig.mode === 'cluster' ? 'segmented active' : 'segmented'} onClick={() => props.onUpdate({ mode: 'cluster' })}>
                Cluster
              </button>
            </div>
            <div className="endpoints-section">
              <div className="section-heading">
                <div className="section-title">Endpoints</div>
                {props.selectedConfig.mode === 'cluster' ? (
                  <button className="secondary compact-secondary" onClick={addEndpoint}>
                    <Plus size={14} />
                    Add Node
                  </button>
                ) : null}
              </div>
              {(props.selectedConfig.mode === 'cluster' ? endpoints : endpoints.slice(0, 1)).map((item, index) => (
                <div className="endpoint-row" key={`${index}-${item.host}-${item.port}`}>
                  <label>
                    Redis Host
                    <input value={item.host} onChange={(event) => updateEndpoint(index, { host: event.target.value })} />
                  </label>
                  <label className="port">
                    Redis Port
                    <input type="number" value={item.port} onChange={(event) => updateEndpoint(index, { port: Number(event.target.value) || 6379 })} />
                  </label>
                  {props.selectedConfig.mode === 'cluster' ? (
                    <button className="icon-button danger endpoint-delete" disabled={endpoints.length === 1} onClick={() => removeEndpoint(index)} title="Remove endpoint">
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="row compact">
              <label>
                Redis Username
                <input value={props.selectedConfig.username ?? ''} onChange={(event) => props.onUpdate({ username: event.target.value || undefined })} />
              </label>
              <label>
                Database
                <input
                  type="number"
                  value={props.selectedConfig.database ?? 0}
                  onChange={(event) => props.onUpdate({ database: Number(event.target.value) || 0 })}
                />
              </label>
            </div>
            <label>
              Redis Password
              <input
                type="password"
                value={props.selectedConfig.password ?? ''}
                onChange={(event) => props.onUpdate({ password: event.target.value || undefined })}
              />
            </label>
            <label className="switch">
              <input type="checkbox" checked={props.selectedConfig.tls ?? false} onChange={(event) => props.onUpdate({ tls: event.target.checked })} />
              TLS
            </label>

            <div className="access-section">
              <div className="section-heading">
                <div className="section-title">
                  <Server size={14} />
                  Access Path
                </div>
                <span className="route-status">{props.sshTunnel.enabled ? 'Via SSH' : 'Direct'}</span>
              </div>
              <div className="route-options">
                <button className={props.sshTunnel.enabled ? 'route-option' : 'route-option active'} onClick={() => props.onUpdateSsh({ enabled: false })}>
                  <span>Direct</span>
                  <small>Use the Redis host and port as configured.</small>
                </button>
                <button className={props.sshTunnel.enabled ? 'route-option active' : 'route-option'} onClick={() => props.onUpdateSsh({ enabled: true })}>
                  <span>SSH Tunnel</span>
                  <small>Forward Redis through a jump host.</small>
                </button>
              </div>
              {props.sshTunnel.enabled ? (
                <div className="ssh-fields">
                  <div className="row">
                    <label>
                      SSH Host / IP
                      <input value={props.sshTunnel.host} onChange={(event) => props.onUpdateSsh({ host: event.target.value })} />
                    </label>
                    <label className="port">
                      SSH Port
                      <input type="number" value={props.sshTunnel.port} onChange={(event) => props.onUpdateSsh({ port: Number(event.target.value) || 22 })} />
                    </label>
                  </div>
                  <label>
                    SSH Username
                    <input value={props.sshTunnel.username} onChange={(event) => props.onUpdateSsh({ username: event.target.value })} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      <LockKeyhole size={12} />
                      SSH Password
                      <em>Optional</em>
                    </span>
                    <input type="password" value={props.sshTunnel.password ?? ''} onChange={(event) => props.onUpdateSsh({ password: event.target.value || undefined })} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      <FileKey2 size={12} />
                      Private Key Path
                      <em>Optional</em>
                    </span>
                    <input value={props.sshTunnel.privateKeyPath ?? ''} onChange={(event) => props.onUpdateSsh({ privateKeyPath: event.target.value || undefined })} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      <FileKey2 size={12} />
                      Private Key Content
                      <em>Optional</em>
                    </span>
                    <textarea value={props.sshTunnel.privateKey ?? ''} onChange={(event) => props.onUpdateSsh({ privateKey: event.target.value || undefined })} rows={4} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      Key Passphrase
                      <em>Optional</em>
                    </span>
                    <input type="password" value={props.sshTunnel.passphrase ?? ''} onChange={(event) => props.onUpdateSsh({ passphrase: event.target.value || undefined })} />
                  </label>
                </div>
              ) : null}
            </div>
            <div className="test-strip">
              <div className="test-action">
                <button className="secondary compact-secondary" disabled={props.testState === 'testing'} onClick={props.onTest}>
                  <FlaskConical size={14} />
                  {props.testState === 'testing' ? 'Testing' : 'Test'}
                </button>
                {props.testState !== 'idle' ? <span className={`test-result ${props.testState}`}>{props.testMessage}</span> : null}
              </div>
              <div className="save-action">
                <span className={`save-indicator ${props.saveState}`}>{saveStateLabel(props.saveState)}</span>
                <button className="primary compact-primary" disabled={props.saveState === 'saved' || props.saveState === 'saving'} onClick={props.onSave}>
                  <Save size={14} />
                  {props.saveState === 'saving' ? 'Saving' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>
    </>
  );
}

function buildKeyTree(keys: KeySummary[]): KeyTreeNode[] {
  const roots: KeyTreeNode[] = [];
  const groups = new Map<string, KeyTreeNode>();

  for (const item of keys) {
    const parts = item.key.split(':').filter((part) => part.length > 0);
    if (parts.length <= 1) {
      roots.push({ id: `key:${item.key}`, label: item.key, children: [], summary: item });
      continue;
    }

    let parentChildren = roots;
    let prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}:${part}` : part;
      let group = groups.get(prefix);
      if (!group) {
        group = { id: prefix, label: part, children: [] };
        groups.set(prefix, group);
        parentChildren.push(group);
      }
      parentChildren = group.children;
    }

    parentChildren.push({ id: `key:${item.key}`, label: parts[parts.length - 1], children: [], summary: item });
  }

  sortKeyTreeNodes(roots);
  return roots;
}

function countLeafNodes(node: KeyTreeNode): number {
  if (node.summary) {
    return 1;
  }
  return node.children.reduce((total, child) => total + countLeafNodes(child), 0);
}

function mergeKeySummaries(existing: KeySummary[], incoming: KeySummary[]): KeySummary[] {
  const byKey = new Map(existing.map((item) => [item.key, item]));
  incoming.forEach((item) => byKey.set(item.key, item));
  return Array.from(byKey.values());
}

function sortKeySummaries(keys: KeySummary[]): KeySummary[] {
  const prefixCounts = new Map<string, number>();
  keys.forEach((item) => {
    const prefix = firstKeyPrefix(item.key);
    if (prefix) {
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  });

  return [...keys].sort((left, right) => {
    const leftGrouped = hasSharedPrefix(left.key, prefixCounts);
    const rightGrouped = hasSharedPrefix(right.key, prefixCounts);
    if (leftGrouped !== rightGrouped) {
      return leftGrouped ? -1 : 1;
    }
    if (leftGrouped && rightGrouped) {
      const prefixOrder = naturalKeyCompare(firstKeyPrefix(left.key) ?? '', firstKeyPrefix(right.key) ?? '');
      if (prefixOrder !== 0) {
        return prefixOrder;
      }
    }
    return naturalKeyCompare(left.key, right.key);
  });
}

function sortKeyTreeNodes(nodes: KeyTreeNode[]): void {
  nodes.sort((left, right) => {
    const leftFoldable = !left.summary;
    const rightFoldable = !right.summary;
    if (leftFoldable !== rightFoldable) {
      return leftFoldable ? -1 : 1;
    }
    return naturalKeyCompare(left.label, right.label);
  });
  nodes.forEach((node) => sortKeyTreeNodes(node.children));
}

function hasSharedPrefix(key: string, prefixCounts: Map<string, number>): boolean {
  const prefix = firstKeyPrefix(key);
  return Boolean(prefix && (prefixCounts.get(prefix) ?? 0) > 1);
}

function firstKeyPrefix(key: string): string | undefined {
  const index = key.indexOf(':');
  if (index <= 0) {
    return undefined;
  }
  return key.slice(0, index);
}

function naturalKeyCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizeScanPattern(pattern: string): string {
  return pattern.trim() || '*';
}

function isEditableKeyType(type: string): type is EditableKeyType {
  return type === 'string' || type === 'hash' || type === 'list' || type === 'set' || type === 'zset';
}

function createValueDraft(preview: KeyPreview): string {
  if (preview.type === 'string') {
    return typeof preview.value === 'string' ? preview.value : '';
  }
  if (preview.type === 'hash' && isRecord(preview.value) && isRecord(preview.value.items)) {
    return JSON.stringify(preview.value.items, null, 2);
  }
  if (preview.type === 'set' && isRecord(preview.value) && Array.isArray(preview.value.items)) {
    return preview.value.items.map(String).join('\n');
  }
  if (preview.type === 'zset' && Array.isArray(preview.value)) {
    const lines: string[] = [];
    for (let index = 0; index < preview.value.length; index += 2) {
      lines.push(`${String(preview.value[index + 1] ?? '')} ${String(preview.value[index] ?? '')}`);
    }
    return lines.join('\n');
  }
  if (Array.isArray(preview.value)) {
    return preview.value.map((item) => (typeof item === 'string' ? item : stringifyPreviewItem(item))).join('\n');
  }
  return '';
}

function getHashEntries(value: unknown): Array<[string, string]> {
  if (!isRecord(value) || !isRecord(value.items)) {
    return [];
  }
  return Object.entries(value.items).map(([field, itemValue]) => [field, String(itemValue)]);
}

function buildSetKeyRequest(connectionId: string, preview: KeyPreview, valueDraft: string): SetKeyRequest {
  if (!isEditableKeyType(preview.type)) {
    throw new Error(`Cannot edit Redis type "${preview.type}".`);
  }

  return {
    connectionId,
    key: preview.key,
    type: preview.type,
    value: parseValueDraft(preview.type, valueDraft),
    ttl: preview.ttl > 0 ? preview.ttl : null
  };
}

function parseValueDraft(type: EditableKeyType, valueDraft: string): unknown {
  switch (type) {
    case 'string':
      return valueDraft;
    case 'hash': {
      const parsed = JSON.parse(valueDraft || '{}') as unknown;
      if (!isRecord(parsed)) {
        throw new Error('Hash value must be a JSON object.');
      }
      return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    }
    case 'list':
    case 'set':
      return valueDraft.length > 0 ? valueDraft.split(/\r?\n/) : [];
    case 'zset':
      return parseZsetDraft(valueDraft);
  }
}

function parseZsetDraft(valueDraft: string): string[] {
  const args: string[] = [];
  const lines = valueDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([+-]?(?:\d+|\d*\.\d+))\s+(.+)$/);
    if (!match) {
      throw new Error('ZSET rows must use "score member".');
    }
    args.push(match[1], match[2]);
  }
  return args;
}

function parseTtlDraft(ttlDraft: string): number | null {
  const trimmed = ttlDraft.trim();
  if (!trimmed) {
    return null;
  }
  const ttl = Number(trimmed);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error('TTL must be a positive whole number.');
  }
  return ttl;
}

function normalizeSavedConnections(saved: SavedConnections): SavedConnections {
  const connections = saved.connections.length > 0 ? saved.connections.map(normalizeConnectionConfig) : [createConnectionConfig()];
  const selectedId = saved.selectedId && connections.some((item) => item.id === saved.selectedId) ? saved.selectedId : connections[0].id;
  return { selectedId, connections };
}

function normalizeConnectionConfig(config: RedisConnectionConfig): RedisConnectionConfig {
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

function formatConsoleValue(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function formatPreviewValue(type: string, value: unknown): string {
  if (value === undefined) {
    return '(empty)';
  }
  if (value === null) {
    return '(nil)';
  }
  if (typeof value === 'string') {
    return value.length > 0 ? revealInvisibleText(value) : '(empty string)';
  }
  if (type === 'hash' && isRecord(value)) {
    const items = value.items;
    if (isRecord(items)) {
      const entries = Object.entries(items);
      return entries.length > 0 ? entries.map(([key, itemValue]) => `${key}: ${String(itemValue)}`).join('\n') : '(empty hash)';
    }
  }
  if (type === 'set' && isRecord(value) && Array.isArray(value.items)) {
    return value.items.length > 0 ? value.items.map(String).join('\n') : '(empty set)';
  }
  if (type === 'zset' && Array.isArray(value)) {
    if (value.length === 0) return '(empty zset)';
    const lines: string[] = [];
    for (let index = 0; index < value.length; index += 2) {
      lines.push(`${String(value[index])}  ${String(value[index + 1] ?? '')}`);
    }
    return lines.join('\n');
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => (typeof item === 'string' ? revealInvisibleText(item) : stringifyPreviewItem(item))).join('\n') : `(empty ${type})`;
  }
  return stringifyPreviewItem(value);
}

function revealInvisibleText(value: string): string {
  if (value.length === 0) {
    return '(empty string)';
  }
  return value.replace(/\0/g, '\\0');
}

function stringifyPreviewItem(value: unknown): string {
  if (value === undefined) return '(empty)';
  if (value === null) return '(nil)';
  if (typeof value === 'string') return revealInvisibleText(value);
  return JSON.stringify(value, null, 2) ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function saveStateLabel(state: SaveState): string {
  switch (state) {
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving';
    case 'error':
      return 'Save failed';
    case 'saved':
    default:
      return 'Saved';
  }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function getRedisGuiApi() {
  if (!window.redisGui) {
    throw new Error('Rist preload API is unavailable. Restart the Electron app and check the preload path.');
  }
  return window.redisGui;
}
