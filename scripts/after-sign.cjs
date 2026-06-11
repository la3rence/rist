const { execFile } = require('node:child_process');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const codesignPath = '/usr/bin/codesign';
const securityPath = '/usr/bin/security';
const maxBuffer = 1024 * 1024 * 16;

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const bundleIdentifier = context.packager.appInfo.id || context.packager.config.appId;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  if (!existsSync(appPath)) {
    return;
  }

  if (await hasStableRequirement(appPath, bundleIdentifier)) {
    return;
  }

  const identity = await findSigningIdentity();
  if (!identity) {
    console.warn('[afterSign] No macOS signing identity found for stable Squirrel.Mac requirement.');
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rist-codesign-'));
  try {
    const args = ['--force', '--sign', identity, '--options', 'runtime'];
    const entitlementsPath = await writeExistingEntitlements(appPath, tempDir);
    if (entitlementsPath) {
      args.push('--entitlements', entitlementsPath);
    }
    if (process.env.CSC_KEYCHAIN) {
      args.push('--keychain', process.env.CSC_KEYCHAIN);
    }
    args.push('-r', `=designated => identifier "${bundleIdentifier}"`, appPath);

    console.warn('[afterSign] Re-signing top-level macOS app with stable requirement for Squirrel.Mac update validation.');
    await execFileAsync(codesignPath, args, { maxBuffer });
    await execFileAsync(codesignPath, ['--verify', '--deep', '--strict', '--verbose=2', appPath], { maxBuffer });
    await execFileAsync(codesignPath, ['--verify', '--deep', '--strict', '--verbose=2', '-R', `=identifier "${bundleIdentifier}"`, appPath], { maxBuffer });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

async function findSigningIdentity() {
  const qualifier = process.env.CSC_NAME?.trim();
  const keychain = process.env.CSC_KEYCHAIN?.trim();
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  if (keychain) {
    args.push(keychain);
  }

  try {
    const { stdout } = await execFileAsync(securityPath, args, { maxBuffer });
    const identities = stdout
      .split('\n')
      .map((line) => {
        const match = line.match(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(.+)"$/);
        return match ? { hash: match[1], name: match[2] } : undefined;
      })
      .filter(Boolean);

    const selected = qualifier ? identities.find((identity) => identity.name.includes(qualifier)) : identities[0];
    return selected?.hash;
  } catch {
    return undefined;
  }
}

async function writeExistingEntitlements(appPath, tempDir) {
  try {
    const { stdout, stderr } = await execFileAsync(codesignPath, ['-d', '--entitlements', ':-', appPath], { maxBuffer });
    const content = stdout.includes('<?xml') || stdout.includes('<plist') ? stdout : stderr;
    const xmlStart = content.indexOf('<?xml');
    const plistStart = xmlStart === -1 ? content.indexOf('<plist') : xmlStart;
    if (plistStart === -1) {
      return undefined;
    }

    const entitlements = content.slice(plistStart).trim();
    if (!entitlements) {
      return undefined;
    }

    const entitlementsPath = path.join(tempDir, 'entitlements.plist');
    await writeFile(entitlementsPath, entitlements, 'utf8');
    return entitlementsPath;
  } catch {
    return undefined;
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
