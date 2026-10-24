#!/usr/bin/env node
// Starts YT Altyazı in the background (if it is not running yet) and opens it in your browser.
// This is what the Windows and Linux desktop shortcuts run (macOS uses scripts/macos-launcher.sh). Optional: PORT=3000.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = `http://localhost:${process.env.PORT || 3000}`;
const isUp = () => fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

if (!(await isUp())) {
  mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  const log = openSync(path.join(ROOT, 'work', 'server.log'), 'a');
  spawn(process.execPath, ['server.js'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
  for (let i = 0; i < 40 && !(await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
}

const [cmd, ...cmdArgs] = process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
  : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => console.log(`Open ${url} in your browser.`)).unref();
