import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';

const updateCheckIntervalMs = 4 * 60 * 60 * 1000;
const { autoUpdater } = electronUpdater;

class UpdateService {
  private state: UpdateStatus = {
    status: 'idle',
    currentVersion: app.getVersion()
  };

  private started = false;
  private checkTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', message: 'Checking for updates' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({
        status: 'available',
        availableVersion: info.version,
        message: 'Update found. Downloading in the background.',
        releaseDate: info.releaseDate,
        releaseName: info.releaseName ?? undefined
      });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setState({
        status: 'downloading',
        percent: progress.percent,
        message: `Downloading update ${Math.round(progress.percent)}%`
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      this.setState({
        status: 'downloaded',
        availableVersion: info.version,
        percent: 100,
        message: 'Update downloaded and ready to install.',
        releaseDate: info.releaseDate,
        releaseName: info.releaseName ?? undefined
      });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.setState({
        status: 'not-available',
        availableVersion: info.version,
        percent: undefined,
        message: 'Rist is up to date.',
        releaseDate: info.releaseDate,
        releaseName: info.releaseName ?? undefined
      });
    });

    autoUpdater.on('update-cancelled', (info: UpdateInfo) => {
      this.setState({
        status: 'idle',
        availableVersion: info.version,
        percent: undefined,
        message: 'Update download cancelled.',
        releaseDate: info.releaseDate,
        releaseName: info.releaseName ?? undefined
      });
    });

    autoUpdater.on('error', (error: Error) => {
      this.setState({
        status: 'error',
        percent: undefined,
        message: error.message || 'Unable to check for updates'
      });
    });

    if (!app.isPackaged) {
      this.setState({
        status: 'disabled',
        message: 'Auto update is available only in packaged builds.'
      });
      return;
    }

    setTimeout(() => {
      void this.checkForUpdates();
    }, 5000);

    this.checkTimer = setInterval(() => {
      void this.checkForUpdates();
    }, updateCheckIntervalMs);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  getStatus(): UpdateStatus {
    return this.state;
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setState({
        status: 'disabled',
        message: 'Auto update is available only in packaged builds.'
      });
      return this.state;
    }

    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'downloaded') {
      return this.state;
    }

    try {
      this.setState({ status: 'checking', percent: undefined, message: 'Checking for updates' });
      await autoUpdater.checkForUpdates();
      return this.state;
    } catch (error) {
      this.setState({
        status: 'error',
        percent: undefined,
        message: error instanceof Error ? error.message : 'Unable to check for updates'
      });
      return this.state;
    }
  }

  installDownloadedUpdate(): UpdateStatus {
    if (this.state.status !== 'downloaded') {
      return this.state;
    }

    this.setState({
      ...this.state,
      status: 'installing',
      message: 'Installing update'
    });
    autoUpdater.quitAndInstall(false, true);
    return this.state;
  }

  private setState(patch: Partial<UpdateStatus>): void {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
      checkedAt: new Date().toISOString()
    };
    this.broadcast();
  }

  private broadcast(): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('updates:statusChanged', this.state);
      }
    });
  }
}

export const updateService = new UpdateService();
