import type { AppSettings, KeySummary, SetKeyRequest } from '../../shared/types';

export type View = 'browser' | 'console' | 'connections';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export type TestState = 'idle' | 'testing' | 'success' | 'error';
export type KeyListMode = AppSettings['keyListMode'];
export type EditableKeyType = SetKeyRequest['type'];
export type SettingsTab = 'general' | 'query' | 'editor';
export type NewKeyDraft = {
  key: string;
  type: 'string' | 'hash';
  value: string;
  hashField: string;
  hashValue: string;
  ttl: string;
};

export type ConsoleEntry = {
  id: string;
  command: string;
  result?: unknown;
  error?: string;
};

export type KeyTreeNode = {
  id: string;
  label: string;
  children: KeyTreeNode[];
  summary?: KeySummary;
};
