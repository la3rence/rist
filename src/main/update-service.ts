import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';

const updateCheckIntervalMs = 4 * 60 * 60 * 1000;
const macShipItCacheNames = ['app.rist.desktop.ShipIt', `${app.getName()}.ShipIt`];
const quarantineValidationErrorPattern = /code signature at URL .* did not pass validation/i;
const quarantineResourceErrorPattern = /code has\s+no resources but signature indicates they must be present/i;
const shipItUpdateAppUrlPattern = /file:\/\/\S+?\.app\/?/i;
const { autoUpdater } = electronUpdater;
const execFileAsync = promisify(execFile);

class UpdateService {
  private state: UpdateStatus = {
    status: 'idle',
    currentVersion: app.getVersion()
  };

  private started = false;
  private checkTimer: NodeJS.Timeout | null = null;
  private quarantineRetryInProgress = false;
  private retriedQuarantinePaths = new Set<string>();

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
      void this.recoverFromQuarantineValidationError(error);
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

  private async recoverFromQuarantineValidationError(error: Error): Promise<void> {
    const appPath = this.getQuarantinedShipItAppPath(error);
    if (!appPath || this.quarantineRetryInProgress || this.retriedQuarantinePaths.has(appPath)) {
      return;
    }

    this.quarantineRetryInProgress = true;
    this.retriedQuarantinePaths.add(appPath);

    try {
      this.setState({
        status: 'checking',
        percent: undefined,
        message: 'Repairing downloaded update quarantine attributes.'
      });
      await execFileAsync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath]);
      this.setState({
        status: 'checking',
        percent: undefined,
        message: 'Retrying update check after quarantine repair.'
      });
      await autoUpdater.checkForUpdates();
    } catch (repairError) {
      this.setState({
        status: 'error',
        percent: undefined,
        message: repairError instanceof Error ? repairError.message : error.message || 'Unable to check for updates'
      });
    } finally {
      this.quarantineRetryInProgress = false;
    }
  }

  private getQuarantinedShipItAppPath(error: Error): string | null {
    if (process.platform !== 'darwin') return null;
    if (!app.isPackaged) return null;

    const message = error.message || '';
    if (!quarantineValidationErrorPattern.test(message) || !quarantineResourceErrorPattern.test(message)) {
      return null;
    }

    const urlMatch = message.match(shipItUpdateAppUrlPattern);
    if (!urlMatch) return null;

    let updateAppPath: string;
    try {
      updateAppPath = path.resolve(fileURLToPath(urlMatch[0]));
    } catch {
      return null;
    }

    const cacheRootPath = path.resolve(app.getPath('home'), 'Library', 'Caches');
    const knownCacheRoots = macShipItCacheNames.map((cacheName) => path.join(cacheRootPath, cacheName));

    if (!knownCacheRoots.some((root) => this.isPathInside(updateAppPath, root))) {
      return null;
    }

    if (path.basename(updateAppPath) !== `${app.getName()}.app` || !existsSync(updateAppPath)) {
      return null;
    }

    return updateAppPath;
  }

  private isPathInside(targetPath: string, rootPath: string): boolean {
    const relativePath = path.relative(rootPath, targetPath);
    return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
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
