const { execFile } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const codesignPath = '/usr/bin/codesign';
const securityPath = '/usr/bin/security';
const maxBuffer = 1024 * 1024 * 16;

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const bundleIdentifier = context.packager.appInfo.id || context.packager.config.appId;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  if (!existsSync(appPath)) {
    return;
  }

  if (await hasMacSigningMaterial()) {
    return;
  }

  if ((await verifyMacApp(appPath)) && (await hasStableRequirement(appPath, bundleIdentifier))) {
    return;
  }

  console.warn('[afterPack] No macOS signing identity found; applying stable ad-hoc signature for Squirrel.Mac update validation.');
  // Do not enable hardened runtime for the ad-hoc fallback; Electron framework loading can fail without Developer ID entitlements.
  await execFileAsync(codesignPath, ['--force', '--deep', '--sign', '-', appPath], { maxBuffer });
  await execFileAsync(codesignPath, ['--force', '--sign', '-', '-r', `=designated => identifier "${bundleIdentifier}"`, appPath], { maxBuffer });
  await execFileAsync(codesignPath, ['--verify', '--deep', '--strict', '--verbose=2', appPath], { maxBuffer });
  await execFileAsync(codesignPath, ['--verify', '--deep', '--strict', '--verbose=2', '-R', `=identifier "${bundleIdentifier}"`, appPath], { maxBuffer });
};

async function hasMacSigningMaterial() {
  if (process.env.CSC_LINK || process.env.CSC_NAME || process.env.CSC_KEYCHAIN) {
    return true;
  }

  try {
    const { stdout } = await execFileAsync(securityPath, ['find-identity', '-v', '-p', 'codesigning'], { maxBuffer });
    return /"((Developer ID Application)|(Mac Developer)):/i.test(stdout);
  } catch {
    return false;
  }
}

async function verifyMacApp(appPath) {
  try {
    await execFileAsync(codesignPath, ['--verify', '--deep', '--strict', '--verbose=2', appPath], { maxBuffer });
    return true;
  } catch {
    return false;
  }
}

async function hasStableRequirement(appPath, bundleIdentifier) {
  try {
    const { stdout, stderr } = await execFileAsync(codesignPath, ['-d', '-r-', appPath], { maxBuffer });
    return `${stdout}\n${stderr}`.includes(`designated => identifier "${bundleIdentifier}"`);
  } catch {
    return false;
  }
}
