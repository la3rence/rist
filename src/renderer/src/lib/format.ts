import type { UpdateStatus } from '../../../shared/types';
import type { SaveState } from '../types';
import type { TFunction } from './i18n';

export function formatConsoleValue(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function saveStateLabel(state: SaveState, t: TFunction): string {
  switch (state) {
    case 'dirty':
      return t('unsavedChanges');
    case 'saving':
      return t('saving');
    case 'error':
      return t('saveFailed');
    case 'saved':
    default:
      return t('saved');
  }
}

export function formatUpdateStatus(status: UpdateStatus, t: TFunction): string {
  switch (status.status) {
    case 'disabled':
      return t('updateDisabled');
    case 'checking':
      return t('updateChecking');
    case 'available':
      return t('updateAvailable', { version: status.availableVersion ?? t('updateNewVersion') });
    case 'downloading':
      return t('updateDownloading', { percent: Math.round(status.percent ?? 0) });
    case 'downloaded':
      return t('updateDownloaded', { version: status.availableVersion ?? '' }).trim();
    case 'not-available':
      return t('updateNotAvailable');
    case 'installing':
      return t('updateInstalling');
    case 'error':
      return t('updateError');
    case 'idle':
    default:
      return t('updateIdle');
  }
}

export function formatUpdateDetail(status: UpdateStatus, t: TFunction): string {
  if (status.status === 'disabled') {
    return t('updateDisabledDetail');
  }
  if (status.status === 'downloaded') {
    return t('updateDownloadedDetail');
  }
  if (status.status === 'downloading') {
    return status.availableVersion ? t('updateDownloadingDetailWithVersion', { version: status.availableVersion }) : t('updateDownloadingDetail');
  }
  if (status.status === 'error') {
    return status.message ?? t('updateRetryLater');
  }
  if (status.status === 'not-available') {
    return t('updateCurrentVersion', { version: status.currentVersion });
  }
  if (status.availableVersion) {
    return t('updateCurrentLatestVersion', { currentVersion: status.currentVersion, availableVersion: status.availableVersion });
  }
  return status.message ?? t('updateCurrentVersion', { version: status.currentVersion || t('updateUnknownVersion') });
}

export function updateActionLabel(status: UpdateStatus, t: TFunction): string {
  switch (status.status) {
    case 'downloaded':
      return t('updateInstallRestart');
    case 'checking':
      return t('updateCheckingAction');
    case 'downloading':
      return t('updateDownloadingAction');
    case 'installing':
      return t('updateInstallingAction');
    case 'disabled':
      return t('updateUnavailableAction');
    default:
      return t('updateCheckAction');
  }
}
