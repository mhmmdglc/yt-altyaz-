import { spawn } from 'node:child_process';
import './config.js'; // adds the usual install folders to PATH

// Runs an external command; resolves with { out, err }, rejects on a non-zero exit code.
// onLine(line, 'out' | 'err') is called for every line while the command runs (progress output; also split at \r).
export function run(cmd, args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const pending = { out: '', err: '' };
    const feed = (kind, d) => {
      if (!onLine) return;
      const parts = (pending[kind] + d.toString()).split(/[\r\n]+/);
      pending[kind] = parts.pop();
      for (const line of parts) if (line) onLine(line, kind);
    };
    child.stdout.on('data', (d) => { out += d.toString(); feed('out', d); });
    child.stderr.on('data', (d) => { err += d.toString(); feed('err', d); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} exited with code ${code}: ${err.slice(-400)}`));
    });
  });
}
