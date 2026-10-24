import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createShortcut, desktopEntry, WINDOWS_SCRIPT, NAME } from '../scripts/shortcut.mjs';

test('desktop entry quotes the paths and starts the launcher without a terminal', () => {
  const text = desktopEntry({ node: '/opt/my node/bin/node', script: '/home/u/yt altyazı/scripts/launch.mjs' });
  assert.match(text, /^\[Desktop Entry\]\nType=Application\n/);
  assert.match(text, /Exec="\/opt\/my node\/bin\/node" "\/home\/u\/yt altyazı\/scripts\/launch\.mjs"/);
  assert.match(text, /Terminal=false/);
});

test('linux shortcut is written as an executable .desktop file', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ytsc-'));
  const [file] = createShortcut({ platform: 'linux', dest: dir });
  assert.equal(file, path.join(dir, `${NAME}.desktop`));
  assert.match(readFileSync(file, 'utf8'), /launch\.mjs/);
  assert.ok(statSync(file).mode & 0o100);
});

test('windows script takes everything from the environment', () => {
  for (const v of ['YT_DEST', 'YT_NAME', 'YT_NODE', 'YT_SCRIPT', 'YT_CWD']) assert.ok(WINDOWS_SCRIPT.includes(`$env:${v}`), v);
  assert.ok(WINDOWS_SCRIPT.includes('.lnk'));
});
