import { spawn } from 'node:child_process';
import './config.js'; // adds the usual install folders to PATH

// Runs an external command; resolves with { out, err }, rejects on a non-zero exit code.
export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} exited with code ${code}: ${err.slice(-400)}`));
    });
  });
}
