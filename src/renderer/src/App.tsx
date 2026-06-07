import { CSSProperties, FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Database,
  FileKey2,
  FlaskConical,
  KeyRound,
  LockKeyhole,
  PanelLeft,
  Plug,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Server,
  Settings2,
  TerminalSquare,
  Trash2
} from 'lucide-react';
import type { ConnectionSummary, KeyPreview, KeySummary, RedisConnectionConfig, SavedConnections, SshTunnelConfig } from '../../shared/types';

type View = 'browser' | 'console' | 'connections';
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type TestState = 'idle' | 'testing' | 'success' | 'error';

type ConsoleEntry = {
  id: string;
  command: string;
  result?: unknown;
  error?: string;
};

const defaultSshTunnel: SshTunnelConfig = { enabled: false, host: '', port: 22, username: '' };
const connectionColors = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#64748b'];
const collapsedSidebarWidth = 88;
const collapseThreshold = 128;

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

export default function App(): JSX.Element {
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
  const [pattern, setPattern] = useState('*');
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [consoleCommand, setConsoleCommand] = useState('');
  const [consoleHistory, setConsoleHistory] = useState<ConsoleEntry[]>([]);

  const selectedConfig = useMemo(() => configs.find((item) => item.id === selectedConfigId) ?? configs[0], [configs, selectedConfigId]);
  const groupedKeys = useMemo(() => buildTree(keys), [keys]);

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
      const result = await api.scanKeys({ connectionId: summary.id, pattern, count: 120 });
      setKeys(result.keys);
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
      const result = await getRedisGuiApi().scanKeys({ connectionId: connection.id, pattern, count: 120 });
      setKeys(result.keys);
      if (selectedKey && !result.keys.some((item) => item.key === selectedKey)) {
        setSelectedKey('');
        setPreview(null);
        setPreviewError('');
      }
      setStatus(`Loaded ${result.keys.length} keys`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Scan failed');
    } finally {
      setBusy(false);
    }
  }

  function clearActiveConnectionState(): void {
    setConnection(null);
    setKeys([]);
    setSelectedKey('');
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError('');
    setConsoleCommand('');
  }

  async function selectKey(key: string): Promise<void> {
    if (!connection) return;
    setSelectedKey(key);
    setPreview(null);
    setPreviewError('');
    setPreviewLoading(true);
    setStatus('Loading preview');
    try {
      setPreview(await getRedisGuiApi().previewKey(connection.id, key));
      setStatus(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview failed';
      setPreviewError(message);
      setStatus(message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!connection || !selectedKey) return;
    const confirmed = window.confirm(`Delete key "${selectedKey}"?`);
    if (!confirmed) return;
    await getRedisGuiApi().deleteKey(connection.id, selectedKey);
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError('');
    setSelectedKey('');
    await refresh();
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
            groupedKeys={groupedKeys}
            keysLength={keys.length}
            pattern={pattern}
            preview={preview}
            previewError={previewError}
            previewLoading={previewLoading}
            selectedKey={selectedKey}
            onDeleteSelected={() => void deleteSelected()}
            onPatternChange={setPattern}
            onRefresh={() => void refresh()}
            onSelectKey={(key) => void selectKey(key)}
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

function BrowserView(props: {
  busy: boolean;
  connection: ConnectionSummary | null;
  groupedKeys: Array<KeySummary & { label: string }>;
  keysLength: number;
  pattern: string;
  preview: KeyPreview | null;
  previewError: string;
  previewLoading: boolean;
  selectedKey: string;
  onDeleteSelected(): void;
  onPatternChange(pattern: string): void;
  onRefresh(): void;
  onSelectKey(key: string): void;
}): JSX.Element {
  return (
    <>
      <header className="toolbar">
        <div className="search">
          <Search size={16} />
          <input value={props.pattern} onChange={(event) => props.onPatternChange(event.target.value)} placeholder="SCAN pattern" />
        </div>
        <button className="icon-button" disabled={!props.connection || props.busy} onClick={props.onRefresh} title="Refresh keys">
          <RefreshCcw size={16} />
        </button>
        <button className="icon-button danger" disabled={!props.selectedKey} onClick={props.onDeleteSelected} title="Delete selected key">
          <Trash2 size={16} />
        </button>
      </header>

      <section className="workspace">
        <section className="key-pane">
          <div className="pane-title">
            <KeyRound size={15} />
            Keys
            <span>{props.keysLength}</span>
          </div>
          <div className="key-tree">
            {props.groupedKeys.map((item) => (
              <button key={item.key} className={props.selectedKey === item.key ? 'key-row selected' : 'key-row'} onClick={() => props.onSelectKey(item.key)}>
                <span className="key-name">{item.label}</span>
                <span className={`type-pill type-${item.type}`}>{item.type}</span>
              </button>
            ))}
          </div>
        </section>

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
                  <p>
                    {props.preview.type} · ttl {props.preview.ttl}
                    {props.preview.size !== undefined ? ` · ${props.preview.size} items` : ''}
                  </p>
                </div>
              </div>
              <pre className="value-preview">{formatPreviewValue(props.preview.type, props.preview.value)}</pre>
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

function ConsoleView(props: {
  command: string;
  connection: ConnectionSummary | null;
  history: ConsoleEntry[];
  onCommandChange(command: string): void;
  onDeleteEntry(id: string): void;
  onRunCommand(event: FormEvent<HTMLFormElement>): void;
}): JSX.Element {
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
}): JSX.Element {
  const endpoint = props.selectedConfig.endpoints[0] ?? { host: '127.0.0.1', port: 6379 };
  const selectedColor = props.selectedConfig.color;
  const [profilesWidth, setProfilesWidth] = useState(280);

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
            <div className="row">
              <label>
                Redis Host
                <input
                  value={endpoint.host}
                  onChange={(event) => props.onUpdate({ endpoints: [{ ...endpoint, host: event.target.value }] })}
                />
              </label>
              <label className="port">
                Redis Port
                <input
                  type="number"
                  value={endpoint.port}
                  onChange={(event) => props.onUpdate({ endpoints: [{ ...endpoint, port: Number(event.target.value) || 6379 }] })}
                />
              </label>
            </div>
            <div className="row compact">
              <button className={props.selectedConfig.mode === 'single' ? 'segmented active' : 'segmented'} onClick={() => props.onUpdate({ mode: 'single' })}>
                Single
              </button>
              <button className={props.selectedConfig.mode === 'cluster' ? 'segmented active' : 'segmented'} onClick={() => props.onUpdate({ mode: 'cluster' })}>
                Cluster
              </button>
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

function buildTree(keys: KeySummary[]): Array<KeySummary & { label: string }> {
  return keys.map((item) => {
    const parts = item.key.split(':');
    return {
      ...item,
      label: parts.length > 1 ? parts.join(' / ') : item.key
    };
  });
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
