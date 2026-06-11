import {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState
} from 'react';
import { ChevronRight, Database, Eye, Folder, KeyRound, Pencil, Plus, RefreshCcw, Save, Search, Trash2, X } from 'lucide-react';
import type { ConnectionSummary, KeyPreview, KeySummary } from '../../../shared/types';
import {
  countLeafNodes,
  createEmptyNewKeyDraft,
  createValueDraft,
  formatPreviewValue,
  getHashEntries,
  isEditableKeyType,
  revealInvisibleText
} from '../lib/keys';
import { useI18n } from '../lib/i18n';
import type { KeyListMode, KeyTreeNode, NewKeyDraft } from '../types';

export function BrowserView(props: {
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
  onLoadMore(): void;
  onPatternChange(pattern: string): void;
  onCreateKey(draft: NewKeyDraft): Promise<void>;
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
  const { t } = useI18n();
  const previewEditable = props.preview ? isEditableKeyType(props.preview.type) : false;
  const [valueEditing, setValueEditing] = useState(false);
  const [ttlEditing, setTtlEditing] = useState(false);
  const [batchDragging, setBatchDragging] = useState(false);
  const [keyPaneWidth, setKeyPaneWidth] = useState(360);
  const [creatingKey, setCreatingKey] = useState(false);
  const [hashAddingField, setHashAddingField] = useState(false);
  const [newKeyDraft, setNewKeyDraft] = useState<NewKeyDraft>(createEmptyNewKeyDraft);
  const [newKeyError, setNewKeyError] = useState('');
  const batchMode = props.batchSelectedKeys.size > 0;
  const isHashPreview = props.preview?.type === 'hash';

  useEffect(() => {
    setValueEditing(false);
    setTtlEditing(false);
    setHashAddingField(false);
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

  async function submitNewKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNewKeyError('');
    try {
      await props.onCreateKey(newKeyDraft);
      setNewKeyDraft(createEmptyNewKeyDraft());
      setCreatingKey(false);
    } catch (error) {
      setNewKeyError(error instanceof Error ? error.message : t('createKeyFailed'));
    }
  }

  return (
    <>
      <header className="toolbar">
        <div className="search">
          <Search size={16} />
          <input value={props.pattern} onChange={(event) => props.onPatternChange(event.target.value)} />
        </div>
        <button className="icon-button" disabled={!props.connection || props.busy} onClick={props.onRefresh} title={t('refreshKeys')}>
          <RefreshCcw size={16} />
        </button>
        <button
          className={creatingKey ? 'icon-button active' : 'icon-button'}
          disabled={!props.connection || props.busy}
          onClick={() => setCreatingKey((value) => !value)}
          title={creatingKey ? t('closeNewKeyForm') : t('addKey')}
        >
          {creatingKey ? <X size={16} /> : <Plus size={16} />}
        </button>
        {batchMode ? (
          <div className="batch-actions">
            <span>{props.batchSelectedKeys.size}</span>
            <button className="icon-button danger" disabled={props.busy} onClick={props.onDeleteBatchSelected} title={t('deleteSelectedKeys')}>
              <Trash2 size={16} />
            </button>
            <button className="secondary compact-secondary" onClick={props.onClearBatchKeys}>
              {t('clear')}
            </button>
          </div>
        ) : null}
      </header>

      <section className={creatingKey ? 'workspace creating-key' : 'workspace'} style={{ '--key-pane-width': `${keyPaneWidth}px` } as CSSProperties}>
        {creatingKey ? (
          <form className="new-key-form" onSubmit={(event) => void submitNewKey(event)}>
            <label>
              {t('key')}
              <input
                autoFocus
                value={newKeyDraft.key}
                onChange={(event) => setNewKeyDraft((draft) => ({ ...draft, key: event.target.value }))}
                spellCheck={false}
              />
            </label>
            <div className="new-key-type" role="group" aria-label={t('newKeyType')}>
              <button
                className={newKeyDraft.type === 'string' ? 'segmented active' : 'segmented'}
                type="button"
                onClick={() => setNewKeyDraft((draft) => ({ ...draft, type: 'string' }))}
              >
                {t('string')}
              </button>
              <button
                className={newKeyDraft.type === 'hash' ? 'segmented active' : 'segmented'}
                type="button"
                onClick={() => setNewKeyDraft((draft) => ({ ...draft, type: 'hash' }))}
              >
                {t('hash')}
              </button>
            </div>
            {newKeyDraft.type === 'hash' ? (
              <>
                <label>
                  {t('field')}
                  <input
                    value={newKeyDraft.hashField}
                    onChange={(event) => setNewKeyDraft((draft) => ({ ...draft, hashField: event.target.value }))}
                    spellCheck={false}
                  />
                </label>
                <label>
                  {t('value')}
                  <input
                    value={newKeyDraft.hashValue}
                    onChange={(event) => setNewKeyDraft((draft) => ({ ...draft, hashValue: event.target.value }))}
                    spellCheck={false}
                  />
                </label>
              </>
            ) : (
              <label>
                {t('value')}
                <input
                  value={newKeyDraft.value}
                  onChange={(event) => setNewKeyDraft((draft) => ({ ...draft, value: event.target.value }))}
                  spellCheck={false}
                />
              </label>
            )}
            <label>
              {t('ttl')}
              <input
                type="number"
                min="1"
                placeholder={t('persist')}
                value={newKeyDraft.ttl}
                onChange={(event) => setNewKeyDraft((draft) => ({ ...draft, ttl: event.target.value }))}
              />
            </label>
            <button className="primary compact-primary" disabled={props.busy} type="submit">
              <Plus size={14} />
              {t('add')}
            </button>
            {newKeyError ? <p className="new-key-error">{newKeyError}</p> : null}
          </form>
        ) : null}
        <section className="key-pane">
          <div className="pane-title">
            <KeyRound size={15} />
            {t('keys')}
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
                {t('loadMore')}
              </button>
            ) : null}
          </div>
        </section>
        <div className="key-pane-resizer" onMouseDown={startKeyPaneResize} />

        <section className={props.preview ? 'preview-pane' : 'preview-pane empty-preview'}>
          {props.previewLoading ? (
            <div className="empty-state">
              <Database size={28} />
              <p>{t('loadingValue')}</p>
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
                  <div className={ttlEditing ? 'preview-meta editing' : 'preview-meta'} onDoubleClick={() => setTtlEditing(true)} title={t('doubleClickEditTtl')}>
                    {ttlEditing ? (
                      <>
                        <span>{props.preview.type} · ttl</span>
                        <input type="number" min="1" value={props.ttlDraft} onChange={(event) => props.onTtlDraftChange(event.target.value)} placeholder={t('persist')} autoFocus />
                        <button
                          className="icon-button header-save-value"
                          disabled={props.savingTtl}
                          onClick={() => {
                            props.onSaveTtl();
                            setTtlEditing(false);
                          }}
                          title={t('saveTtl')}
                        >
                          <Save size={15} />
                        </button>
                        {props.preview.size !== undefined ? <span>· {t('itemCount', { count: props.preview.size })}</span> : null}
                      </>
                    ) : (
                      <>
                        {props.preview.type} · ttl {props.preview.ttl}
                        {props.preview.size !== undefined ? ` · ${t('itemCount', { count: props.preview.size })}` : ''}
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
                        title={valueEditing ? t('previewValue') : t('editValue')}
                      >
                        {valueEditing ? <Eye size={15} /> : <Pencil size={15} />}
                      </button>
                      {valueEditing ? (
                        <button className="icon-button header-save-value" disabled={props.savingValue} onClick={props.onSaveValue} title={t('saveValue')}>
                          <Save size={15} />
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {isHashPreview && !valueEditing ? (
                    <button className={hashAddingField ? 'icon-button active' : 'icon-button'} disabled={props.savingValue} onClick={() => setHashAddingField((value) => !value)} title={t('addHashField')}>
                      {hashAddingField ? <X size={15} /> : <Plus size={15} />}
                    </button>
                  ) : null}
                  <button className="icon-button danger" onClick={props.onDeleteSelected} title={t('deleteSelectedKey')}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {props.ttlEditError ? <div className="header-edit-error">{props.ttlEditError}</div> : null}
              <div className={!valueEditing && isHashPreview ? 'preview-body hash-preview-body' : 'preview-body'}>
                <section className={`${valueEditing ? 'value-card editing' : 'value-card'}${!valueEditing && isHashPreview ? ' hash-value-card' : ''}`}>
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
                      addingField={hashAddingField}
                      savingValue={props.savingValue}
                      onAddingFieldChange={setHashAddingField}
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
              <p>{props.connection ? t('noKeySelected') : t('noConnection')}</p>
            </div>
          )}
        </section>
      </section>
    </>
  );
}

function ValuePreviewContent(props: {
  preview: KeyPreview;
  addingField: boolean;
  savingValue: boolean;
  onAddingFieldChange(addingField: boolean): void;
  onSaveHashField(field: string, value: string): void;
}): ReactElement {
  const { t } = useI18n();
  if (props.preview.type === 'hash') {
    return (
      <HashPreviewTable
        preview={props.preview}
        addingField={props.addingField}
        savingValue={props.savingValue}
        onAddingFieldChange={props.onAddingFieldChange}
        onSaveHashField={props.onSaveHashField}
      />
    );
  }

  return <pre className="value-preview">{formatPreviewValue(props.preview.type, props.preview.value, t)}</pre>;
}

function HashPreviewTable(props: {
  preview: KeyPreview;
  addingField: boolean;
  savingValue: boolean;
  onAddingFieldChange(addingField: boolean): void;
  onSaveHashField(field: string, value: string): void;
}): ReactElement {
  const { t } = useI18n();
  const entries = getHashEntries(props.preview.value);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState('');
  const [newFieldDraft, setNewFieldDraft] = useState('');
  const [newValueDraft, setNewValueDraft] = useState('');
  const [newFieldError, setNewFieldError] = useState('');
  const cancellingEdit = useRef(false);

  useEffect(() => {
    setEditingField(null);
    setFieldDraft('');
    setNewFieldDraft('');
    setNewValueDraft('');
    setNewFieldError('');
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

  function submitNewField(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const field = newFieldDraft.trim();
    if (!field) {
      setNewFieldError(t('fieldRequired'));
      return;
    }
    if (entries.some(([itemField]) => itemField === field)) {
      setNewFieldError(t('fieldAlreadyExists'));
      return;
    }
    setNewFieldError('');
    props.onSaveHashField(field, newValueDraft);
    props.onAddingFieldChange(false);
    setNewFieldDraft('');
    setNewValueDraft('');
  }

  return (
    <div className="hash-preview">
      {props.addingField ? (
        <form className="hash-add-form" onSubmit={submitNewField}>
          <input
            autoFocus
            value={newFieldDraft}
            onChange={(event) => setNewFieldDraft(event.target.value)}
            placeholder={t('field')}
            spellCheck={false}
          />
          <input value={newValueDraft} onChange={(event) => setNewValueDraft(event.target.value)} placeholder={t('value')} spellCheck={false} />
          <button className="primary compact-primary" disabled={props.savingValue} type="submit">
            <Plus size={14} />
            {t('add')}
          </button>
          {newFieldError ? <p className="hash-add-error">{newFieldError}</p> : null}
        </form>
      ) : null}
      {entries.length === 0 ? (
        <pre className="value-preview">{t('emptyHash')}</pre>
      ) : (
        <div className="hash-table" role="table" aria-label={t('hashFields')}>
          <div className="hash-table-head" role="row">
            <div role="columnheader">{t('field')}</div>
            <div role="columnheader">{t('content')}</div>
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
      )}
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
  const { t } = useI18n();
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
      <button className="key-delete-action" onClick={() => props.onDeleteKey(props.item.key)} title={t('deleteSelectedKey')}>
        {t('delete')}
      </button>
      <div className={props.selectedKey === props.item.key ? 'key-row selected' : 'key-row'}>
        {props.batchMode ? (
          <input
            aria-label={`${t('selectKey')} ${props.item.key}`}
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
