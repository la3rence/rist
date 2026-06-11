import { useEffect, useState } from 'react';
import { translate } from '../../../shared/i18n';
import type { UpdateStatus } from '../../../shared/types';
import { getRedisGuiApi } from '../lib/api';
import { defaultSettings, defaultUpdateStatus } from '../lib/constants';

export function useUpdateStatus(): {
  updateStatus: UpdateStatus;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
} {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(defaultUpdateStatus);

  useEffect(() => {
    let cancelled = false;
    const api = getRedisGuiApi();

    api
      .getUpdateStatus()
      .then((status) => {
        if (!cancelled) {
          setUpdateStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setUpdateStatus({
            ...defaultUpdateStatus,
            status: 'error',
            message: error instanceof Error ? error.message : translate(defaultSettings.language, 'unableToLoadUpdateStatus')
          });
        }
      });

    const unsubscribe = api.onUpdateStatusChanged((status) => {
      setUpdateStatus(status);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function checkForUpdates(): Promise<void> {
    const status = await getRedisGuiApi().checkForUpdates();
    setUpdateStatus(status);
  }

  async function installUpdate(): Promise<void> {
    const status = await getRedisGuiApi().installUpdate();
    setUpdateStatus(status);
  }

  return { updateStatus, checkForUpdates, installUpdate };
}
