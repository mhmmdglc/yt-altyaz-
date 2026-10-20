// Opens an address in the default browser (macOS / Windows / Linux).
import { spawn } from 'node:child_process';

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // if no browser can be opened, stay quiet: the address is printed anyway
    child.unref();
  } catch { /* yoksay */ }
}
