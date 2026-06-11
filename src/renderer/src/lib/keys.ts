import { defaultLanguage, translate } from '../../../shared/i18n';
import type { KeyPreview, KeySummary, SetKeyRequest } from '../../../shared/types';
import type { EditableKeyType, KeyTreeNode, NewKeyDraft } from '../types';
import type { TFunction } from './i18n';

export function buildKeyTree(keys: KeySummary[]): KeyTreeNode[] {
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

export function countLeafNodes(node: KeyTreeNode): number {
  if (node.summary) {
    return 1;
  }
  return node.children.reduce((total, child) => total + countLeafNodes(child), 0);
}

export function mergeKeySummaries(existing: KeySummary[], incoming: KeySummary[]): KeySummary[] {
  const byKey = new Map(existing.map((item) => [item.key, item]));
  incoming.forEach((item) => byKey.set(item.key, item));
  return Array.from(byKey.values());
}

export function sortKeySummaries(keys: KeySummary[]): KeySummary[] {
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

export function normalizeScanPattern(pattern: string): string {
  return pattern.trim() || '*';
}

export function isEditableKeyType(type: string): type is EditableKeyType {
  return type === 'string' || type === 'hash' || type === 'list' || type === 'set' || type === 'zset';
}

export function createValueDraft(preview: KeyPreview): string {
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

export function createEmptyNewKeyDraft(): NewKeyDraft {
  return {
    key: '',
    type: 'string',
    value: '',
    hashField: '',
    hashValue: '',
    ttl: ''
  };
}

export function buildCreateKeyRequest(connectionId: string, draft: NewKeyDraft, t: TFunction): SetKeyRequest {
  const key = draft.key.trim();
  if (!key) {
    throw new Error(t('keyRequired'));
  }

  const ttl = parseTtlDraft(draft.ttl, t);
  if (draft.type === 'hash') {
    const field = draft.hashField.trim();
    if (!field) {
      throw new Error(t('hashFieldRequired'));
    }
    return {
      connectionId,
      key,
      type: 'hash',
      value: { [field]: draft.hashValue },
      ttl
    };
  }

  return {
    connectionId,
    key,
    type: 'string',
    value: draft.value,
    ttl
  };
}

export function getHashEntries(value: unknown): Array<[string, string]> {
  if (!isRecord(value) || !isRecord(value.items)) {
    return [];
  }
  return Object.entries(value.items).map(([field, itemValue]) => [field, String(itemValue)]);
}

export function buildSetKeyRequest(connectionId: string, preview: KeyPreview, valueDraft: string, t: TFunction): SetKeyRequest {
  if (!isEditableKeyType(preview.type)) {
    throw new Error(t('cannotEditRedisType', { type: preview.type }));
  }

  return {
    connectionId,
    key: preview.key,
    type: preview.type,
    value: parseValueDraft(preview.type, valueDraft, t),
    ttl: preview.ttl > 0 ? preview.ttl : null
  };
}

function parseValueDraft(type: EditableKeyType, valueDraft: string, t: TFunction): unknown {
  switch (type) {
    case 'string':
      return valueDraft;
    case 'hash': {
      const parsed = JSON.parse(valueDraft || '{}') as unknown;
      if (!isRecord(parsed)) {
        throw new Error(t('hashValueJsonObject'));
      }
      return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    }
    case 'list':
    case 'set':
      return valueDraft.length > 0 ? valueDraft.split(/\r?\n/) : [];
    case 'zset':
      return parseZsetDraft(valueDraft, t);
  }
}

function parseZsetDraft(valueDraft: string, t: TFunction): string[] {
  const args: string[] = [];
  const lines = valueDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([+-]?(?:\d+|\d*\.\d+))\s+(.+)$/);
    if (!match) {
      throw new Error(t('zsetRowsFormat'));
    }
    args.push(match[1], match[2]);
  }
  return args;
}

export function parseTtlDraft(ttlDraft: string, t: TFunction): number | null {
  const trimmed = ttlDraft.trim();
  if (!trimmed) {
    return null;
  }
  const ttl = Number(trimmed);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error(t('ttlPositiveInteger'));
  }
  return ttl;
}

export function formatPreviewValue(type: string, value: unknown, t: TFunction): string {
  if (value === undefined) {
    return t('empty');
  }
  if (value === null) {
    return t('nil');
  }
  if (typeof value === 'string') {
    return value.length > 0 ? revealInvisibleText(value) : t('emptyString');
  }
  if (type === 'hash' && isRecord(value)) {
    const items = value.items;
    if (isRecord(items)) {
      const entries = Object.entries(items);
      return entries.length > 0 ? entries.map(([key, itemValue]) => `${key}: ${String(itemValue)}`).join('\n') : t('emptyHash');
    }
  }
  if (type === 'set' && isRecord(value) && Array.isArray(value.items)) {
    return value.items.length > 0 ? value.items.map(String).join('\n') : t('emptySet');
  }
  if (type === 'zset' && Array.isArray(value)) {
    if (value.length === 0) return t('emptyZset');
    const lines: string[] = [];
    for (let index = 0; index < value.length; index += 2) {
      lines.push(`${String(value[index])}  ${String(value[index + 1] ?? '')}`);
    }
    return lines.join('\n');
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => (typeof item === 'string' ? revealInvisibleText(item) : stringifyPreviewItem(item, t))).join('\n') : t('emptyTyped', { type });
  }
  return stringifyPreviewItem(value, t);
}

export function revealInvisibleText(value: string): string {
  if (value.length === 0) {
    return translate(defaultLanguage, 'emptyString');
  }
  return value.replace(/\0/g, '\\0');
}

function stringifyPreviewItem(value: unknown, t: TFunction = (key, params) => translate(defaultLanguage, key, params)): string {
  if (value === undefined) return t('empty');
  if (value === null) return t('nil');
  if (typeof value === 'string') return revealInvisibleText(value);
  return JSON.stringify(value, null, 2) ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
