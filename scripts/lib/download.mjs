// Resumable, checksum-verified file download (Node 20+, no dependencies).
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const fmtMB = (n) => `${(n / 1e6).toFixed(0)} MB`;

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

// Expected sha256 of a file in a Hugging Face repo (the LFS object id is the sha256). Returns null if unavailable.
export async function huggingFaceSha256(repo, file) {
  try {
    const r = await fetch(`https://huggingface.co/api/models/${repo}/tree/main`, { signal: AbortSignal.timeout(20_000) });
    const entry = (await r.json()).find((f) => f.path === file);
    return entry?.lfs?.oid ?? null;
  } catch {
    return null;
  }
}

// Downloads `url` to `dest`. Data goes to `dest.part` first and is renamed only after the checksum matches,
// so a half-finished download is never mistaken for an installed file. Re-running resumes where it stopped.
export async function download(url, dest, { sha256 = null, label = path.basename(dest), retryDelayMs = 2000 } = {}) {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    if (!sha256 || (await sha256File(dest)) === sha256) return { skipped: true };
    rmSync(dest); // corrupt: fetch again
  }

  const part = `${dest}.part`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const have = existsSync(part) ? statSync(part).size : 0;
    try {
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow' });
      if (res.status === 416) break; // already complete
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const resumed = res.status === 206;
      const offset = resumed ? have : 0;
      const total = offset + Number(res.headers.get('content-length') || 0);
      const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' });
      let got = offset;
      let last = 0;
      try {
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          got += chunk.length;
          if (process.stdout.isTTY && Date.now() - last > 250) {
            last = Date.now();
            const pct = total ? ` ${((got / total) * 100).toFixed(0)}%` : '';
            process.stdout.write(`\r  ${label}: ${fmtMB(got)}${total ? ` / ${fmtMB(total)}` : ''}${pct}   `);
          }
        }
      } finally {
        // Flush to disk even if the connection broke, so the next attempt resumes from the real size
        await new Promise((r) => out.end(r));
      }
      if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(70) + '\r');
      break;
    } catch (e) {
      if (attempt === 5) throw new Error(`Download failed: ${e.message}`);
      console.log(`  connection problem (${e.message}); retrying (${attempt}/5)…`);
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }

  if (sha256 && (await sha256File(part)) !== sha256) {
    rmSync(part);
    throw new Error('Checksum mismatch: the download was corrupted. Run the command again.');
  }
  renameSync(part, dest);
  return { skipped: false };
}
