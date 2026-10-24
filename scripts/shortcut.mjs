#!/usr/bin/env node
// npm run shortcut — puts a "YT Altyazı" shortcut on your Desktop that starts the app and opens the browser.
//   npm run shortcut                              macOS: an app · Windows: a .lnk · Linux: a .desktop launcher
//   npm run shortcut -- --browser "Google Chrome" macOS only: choose the browser
//   npm run shortcut -- --dest ~/Desktop          another folder
// The shortcut points at this folder and at the Node.js that runs this script: if you move either, run it again.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAME = 'YT Altyazı';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const quote = (s) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`; // the Exec= field of a .desktop file

export function desktopEntry({ node, script }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${NAME}`,
    'Comment=Learn English from videos: subtitle cards, translation, speaking practice',
    `Exec=${quote(node)} ${quote(script)}`,
    `Path=${ROOT}`,
    'Terminal=false',
    'Categories=Education;',
    ''
  ].join('\n');
}

// PowerShell that creates the .lnk; the values come in through the environment, so no quoting problems
export const WINDOWS_SCRIPT = [
  "$d = if ($env:YT_DEST) { $env:YT_DEST } else { [Environment]::GetFolderPath('Desktop') }",
  "$p = Join-Path $d ($env:YT_NAME + '.lnk')",
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($p)',
  '$s.TargetPath = $env:YT_NODE',
  "$s.Arguments = '\"' + $env:YT_SCRIPT + '\"'",
  '$s.WorkingDirectory = $env:YT_CWD',
  '$s.WindowStyle = 7',
  '$s.Description = $env:YT_NAME',
  '$s.Save()',
  'Write-Output $p'
].join('; ');

function linuxDesktopDir() {
  try {
    const d = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim();
    if (d && d !== os.homedir()) return d;
  } catch { /* xdg-user-dir is not installed */ }
  return path.join(os.homedir(), 'Desktop');
}

// Returns the paths that were created
export function createShortcut({ platform = process.platform, dest, browser } = {}) {
  const node = process.execPath;
  const launcher = path.join(HERE, 'launch.mjs');
  if (platform === 'darwin') {
    const args = ['--dest', dest || path.join(os.homedir(), 'Desktop')];
    if (browser) args.push('--browser', browser);
    execFileSync('sh', [path.join(HERE, 'create-macos-app.sh'), ...args], { stdio: 'pipe' });
    return [path.join(args[1], `${NAME}.app`)];
  }
  if (platform === 'win32') {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, YT_DEST: dest || '', YT_NAME: NAME, YT_NODE: node, YT_SCRIPT: launcher, YT_CWD: ROOT }
    });
    return [out.trim()];
  }
  const made = [];
  const entry = desktopEntry({ node, script: launcher });
  const targets = dest ? [dest] : [path.join(os.homedir(), '.local', 'share', 'applications'), linuxDesktopDir()];
  for (const dir of targets) {
    if (!dest && !existsSync(dir) && dir !== targets[0]) continue; // no Desktop folder: the applications menu entry is enough
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${NAME}.desktop`);
    writeFileSync(file, entry);
    chmodSync(file, 0o755);
    try { execFileSync('gio', ['set', file, 'metadata::trusted', 'true'], { stdio: 'ignore' }); } catch { /* GNOME only; other desktops do not need it */ }
    made.push(file);
  }
  return made;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  try {
    for (const f of createShortcut({ dest: option('dest'), browser: option('browser') })) console.log(`✓ Shortcut: ${f}`);
    if (process.platform === 'linux') console.log('  If your desktop shows it as untrusted, right-click it and choose "Allow Launching".');
  } catch (e) {
    console.error(`✗ Could not create the shortcut: ${e.message}`);
    process.exit(1);
  }
}
