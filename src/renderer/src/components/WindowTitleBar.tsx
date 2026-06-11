import type { ReactElement } from 'react';
import { Database, RefreshCcw } from 'lucide-react';
import type { UpdateStatus } from '../../../shared/types';
import { formatUpdateStatus } from '../lib/format';
import { useI18n } from '../lib/i18n';

export function WindowTitleBar(props: { title: string; updateStatus?: UpdateStatus; onInstallUpdate?(): void }): ReactElement {
  const { t } = useI18n();
  const updateStatus = props.updateStatus;
  const showInstallButton = updateStatus?.status === 'downloaded' && props.onInstallUpdate;

  return (
    <header className="window-titlebar" aria-label={t('windowTitleBar')}>
      <div className="window-titlebar-title">
        <Database size={15} />
        <span>{props.title}</span>
      </div>
      <div className="window-titlebar-actions">
        {showInstallButton ? (
          <button className="titlebar-update-button" onClick={props.onInstallUpdate} title={formatUpdateStatus(updateStatus, t)}>
            <RefreshCcw size={14} />
            {t('installUpdate')}
          </button>
        ) : null}
      </div>
      <div className="window-titlebar-controls" aria-hidden="true" />
    </header>
  );
}
