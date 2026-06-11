import { defaultLanguage } from '../../../shared/i18n';
import type { AppSettings, SshTunnelConfig, UpdateStatus } from '../../../shared/types';

export const defaultSshTunnel: SshTunnelConfig = { enabled: false, host: '', port: 22, username: '' };
export const connectionColors = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#64748b'];
export const defaultSettings: AppSettings = { keyListMode: 'raw', keyScanCount: 1000, themeMode: 'system', language: defaultLanguage };
export const defaultUpdateStatus: UpdateStatus = { status: 'idle', currentVersion: '' };
export const collapsedSidebarWidth = 88;
export const collapseThreshold = 128;
