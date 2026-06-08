import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import https from 'node:https';

const require = createRequire(import.meta.url);
const electronPackagePath = require.resolve('electron/package.json');
const electronDir = dirname(electronPackagePath);
const { version } = require(electronPackagePath);
const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform;
const arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch;
const platformPath = getPlatformPath(platform);
const executablePath = join(electronDir, 'dist', platformPath);
const pathFile = join(electronDir, 'path.txt');

if (existsSync(executablePath)) {
  writeFileSync(pathFile, platformPath);
  process.exit(0);
}

const mirror = normalizeMirror(
  process.env.npm_config_electron_mirror ||
    process.env.npm_config_electronMirror ||
    process.env.NPM_CONFIG_ELECTRON_MIRROR ||
    process.env.ELECTRON_MIRROR ||
    'https://npmmirror.com/mirrors/electron/'
);
const fileName = `electron-v${version}-${platform}-${arch}.zip`;
const url = `${mirror}v${version}/${fileName}`;
const zipPath = join(electronDir, fileName);

console.log(`Installing Electron ${version} from ${url}`);
await download(url, zipPath);

rmSync(join(electronDir, 'dist'), { recursive: true, force: true });
mkdirSync(join(electronDir, 'dist'), { recursive: true });
extractZip(zipPath, join(electronDir, 'dist'));
writeFileSync(pathFile, platformPath);

if (!existsSync(executablePath)) {
  throw new Error(`Electron executable was not found after install: ${executablePath}`);
}

function getPlatformPath(targetPlatform) {
  switch (targetPlatform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'win32':
      return 'electron.exe';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    default:
      throw new Error(`Electron builds are not available on platform: ${targetPlatform}`);
  }
}

function normalizeMirror(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download Electron: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

function extractZip(zipPath, destination) {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) {
      throw new Error('Failed to extract Electron zip with PowerShell');
    }
    return;
  }

  const result = spawnSync('unzip', ['-q', zipPath, '-d', destination], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('Failed to extract Electron zip with unzip');
  }
}
