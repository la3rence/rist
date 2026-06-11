import { CSSProperties, MouseEvent, ReactElement, useState } from 'react';
import { Copy, Database, FileKey2, FlaskConical, LockKeyhole, Plug, Plus, Save, Server, Trash2 } from 'lucide-react';
import type { RedisConnectionConfig, SshTunnelConfig } from '../../../shared/types';
import { connectionColors } from '../lib/constants';
import { saveStateLabel } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { SaveState, TestState } from '../types';

export function ConnectionsView(props: {
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
  const { t } = useI18n();
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
    const confirmed = window.confirm(t('deleteEndpointConfirm'));
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
          <h1>{t('connections')}</h1>
          <span>{t('profileCount', { count: props.configs.length })}</span>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" onClick={props.onAdd} title={t('addConnection')}>
            <Plus size={16} />
          </button>
          <button className="icon-button" onClick={props.onDuplicate} title={t('duplicateConnection')}>
            <Copy size={16} />
          </button>
          <button className="icon-button danger" disabled={props.configs.length === 1} onClick={props.onDelete} title={t('deleteConnection')}>
            <Trash2 size={16} />
          </button>
          <button className="primary compact-primary" disabled={props.busy} onClick={props.onConnect}>
            <Plug size={14} />
            {t('connect')}
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
                title={t('doubleClickConnect')}
              >
                <span className={config.color ? 'profile-color' : 'profile-color empty'} style={{ background: config.color ?? 'transparent' }} />
                <span className="profile-main">
                  <span>{config.name}</span>
                  <small>{first ? `${first.host}:${first.port}` : t('noEndpoint')}</small>
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
              {t('name')}
              <input value={props.selectedConfig.name} onChange={(event) => props.onUpdate({ name: event.target.value })} />
            </label>
            <div className="color-field">
              <span>
                {t('profileColor')}
                <em>{t('optional')}</em>
              </span>
              <div className="color-swatches">
                <button className={!selectedColor ? 'color-none selected' : 'color-none'} onClick={() => props.onUpdate({ color: undefined })}>
                  {t('none')}
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
            <div className="form-field">
              <span>{t('mode')}</span>
              <div className="connection-segmented">
                <button className={props.selectedConfig.mode === 'single' ? 'segmented active' : 'segmented'} onClick={() => props.onUpdate({ mode: 'single' })}>
                  {t('single')}
                </button>
                <button className={props.selectedConfig.mode === 'cluster' ? 'segmented active' : 'segmented'} onClick={() => props.onUpdate({ mode: 'cluster' })}>
                  {t('cluster')}
                </button>
              </div>
            </div>
            <div className="endpoints-section">
              <div className="section-heading">
                <div className="section-title">{t('endpoints')}</div>
                {props.selectedConfig.mode === 'cluster' ? (
                  <button className="secondary compact-secondary" onClick={addEndpoint}>
                    <Plus size={14} />
                    {t('addNode')}
                  </button>
                ) : null}
              </div>
              {(props.selectedConfig.mode === 'cluster' ? endpoints : endpoints.slice(0, 1)).map((item, index) => (
                <div className="endpoint-row" key={`${index}-${item.host}-${item.port}`}>
                  <label>
                    {t('host')}
                    <input value={item.host} onChange={(event) => updateEndpoint(index, { host: event.target.value })} />
                  </label>
                  <label className="port">
                    {t('port')}
                    <input type="number" value={item.port} onChange={(event) => updateEndpoint(index, { port: Number(event.target.value) || 6379 })} />
                  </label>
                  {props.selectedConfig.mode === 'cluster' ? (
                    <button className="icon-button danger endpoint-delete" disabled={endpoints.length === 1} onClick={() => removeEndpoint(index)} title={t('removeEndpoint')}>
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="row compact">
              <label>
                {t('username')}
                <input value={props.selectedConfig.username ?? ''} onChange={(event) => props.onUpdate({ username: event.target.value || undefined })} />
              </label>
              <label>
                {t('database')}
                <input
                  type="number"
                  value={props.selectedConfig.database ?? 0}
                  onChange={(event) => props.onUpdate({ database: Number(event.target.value) || 0 })}
                />
              </label>
            </div>
            <label>
              {t('password')}
              <input
                type="password"
                value={props.selectedConfig.password ?? ''}
                onChange={(event) => props.onUpdate({ password: event.target.value || undefined })}
              />
            </label>
            <label className="switch field-switch">
              <span>TLS</span>
              <input type="checkbox" checked={props.selectedConfig.tls ?? false} onChange={(event) => props.onUpdate({ tls: event.target.checked })} />
            </label>

            <div className="access-section">
              <div className="section-heading">
                <div className="section-title">
                  <Server size={14} />
                  {t('accessPath')}
                </div>
                <span className="route-status">{props.sshTunnel.enabled ? t('viaSsh') : t('direct')}</span>
              </div>
              <div className="route-options">
                <button className={props.sshTunnel.enabled ? 'route-option' : 'route-option active'} onClick={() => props.onUpdateSsh({ enabled: false })}>
                  <span>{t('direct')}</span>
                  <small>{t('directDescription')}</small>
                </button>
                <button className={props.sshTunnel.enabled ? 'route-option active' : 'route-option'} onClick={() => props.onUpdateSsh({ enabled: true })}>
                  <span>{t('sshTunnel')}</span>
                  <small>{t('sshTunnelDescription')}</small>
                </button>
              </div>
              {props.sshTunnel.enabled ? (
                <div className="ssh-fields">
                  <div className="row">
                    <label>
                      {t('sshHostIp')}
                      <input value={props.sshTunnel.host} onChange={(event) => props.onUpdateSsh({ host: event.target.value })} />
                    </label>
                    <label className="port">
                      {t('sshPort')}
                      <input type="number" value={props.sshTunnel.port} onChange={(event) => props.onUpdateSsh({ port: Number(event.target.value) || 22 })} />
                    </label>
                  </div>
                  <label>
                    {t('sshUsername')}
                    <input value={props.sshTunnel.username} onChange={(event) => props.onUpdateSsh({ username: event.target.value })} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      <LockKeyhole size={12} />
                      {t('sshPassword')}
                      <em>{t('optional')}</em>
                    </span>
                    <input type="password" value={props.sshTunnel.password ?? ''} onChange={(event) => props.onUpdateSsh({ password: event.target.value || undefined })} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      <FileKey2 size={12} />
                      {t('privateKeyPath')}
                      <em>{t('optional')}</em>
                    </span>
                    <input value={props.sshTunnel.privateKeyPath ?? ''} onChange={(event) => props.onUpdateSsh({ privateKeyPath: event.target.value || undefined })} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      <FileKey2 size={12} />
                      {t('privateKeyContent')}
                      <em>{t('optional')}</em>
                    </span>
                    <textarea value={props.sshTunnel.privateKey ?? ''} onChange={(event) => props.onUpdateSsh({ privateKey: event.target.value || undefined })} rows={4} />
                  </label>
                  <label>
                    <span className="label-with-icon">
                      {t('keyPassphrase')}
                      <em>{t('optional')}</em>
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
                  {props.testState === 'testing' ? t('testing') : t('test')}
                </button>
                {props.testState !== 'idle' ? <span className={`test-result ${props.testState}`}>{props.testMessage}</span> : null}
              </div>
              <div className="save-action">
                <span className={`save-indicator ${props.saveState}`}>{saveStateLabel(props.saveState, t)}</span>
                <button className="primary compact-primary" disabled={props.saveState === 'saved' || props.saveState === 'saving'} onClick={props.onSave}>
                  <Save size={14} />
                  {props.saveState === 'saving' ? t('saving') : t('save')}
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>
    </>
  );
}
