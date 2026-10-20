import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { download, sha256File } from '../scripts/lib/download.mjs';

const payload = randomBytes(300_000);
const sha = createHash('sha256').update(payload).digest('hex');
let requests = [];

// Test server with Range support; `dropAfter` simulates a connection that breaks half-way
let dropAfter = null;
const server = http.createServer((req, res) => {
  const range = /bytes=(\d+)-/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  requests.push({ start });
  const chunk = payload.subarray(start);
  res.writeHead(range ? 206 : 200, { 'Content-Length': chunk.length });
  if (dropAfter && !range) {
    res.flushHeaders();
    res.write(chunk.subarray(0, dropAfter));
    return void setTimeout(() => res.destroy(), 30); // headers and part of the body arrive, then the connection breaks
  }
  res.end(chunk);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/model.bin`;
const dir = mkdtempSync(path.join(os.tmpdir(), 'dl-'));
test.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

test('downloads, verifies the checksum and leaves no .part file', async () => {
  const dest = path.join(dir, 'a.bin');
  const r = await download(url, dest, { sha256: sha });
  assert.equal(r.skipped, false);
  assert.equal(await sha256File(dest), sha);
  assert.ok(!existsSync(`${dest}.part`));
});

test('an already installed, correct file is not downloaded again', async () => {
  const dest = path.join(dir, 'a.bin');
  requests = [];
  const r = await download(url, dest, { sha256: sha });
  assert.equal(r.skipped, true);
  assert.equal(requests.length, 0);
});

test('resumes a half-finished .part file with a Range request', async () => {
  const dest = path.join(dir, 'b.bin');
  writeFileSync(`${dest}.part`, payload.subarray(0, 100_000));
  requests = [];
  await download(url, dest, { sha256: sha });
  assert.equal(requests[0].start, 100_000);
  assert.deepEqual(readFileSync(dest), payload);
});

test('recovers from a connection that breaks half-way', async () => {
  const dest = path.join(dir, 'c.bin');
  dropAfter = 120_000;
  requests = [];
  try {
    await download(url, dest, { sha256: sha, retryDelayMs: 10 });
  } finally {
    dropAfter = null;
  }
  assert.equal(await sha256File(dest), sha);
  assert.ok(requests.length >= 2, 'a second (resumed) request was made');
});

test('a wrong checksum is rejected and the partial file is removed (never installed)', async () => {
  const dest = path.join(dir, 'd.bin');
  await assert.rejects(() => download(url, dest, { sha256: 'f'.repeat(64) }), /Checksum mismatch/);
  assert.ok(!existsSync(dest));
  assert.ok(!existsSync(`${dest}.part`));
});

test('a corrupt existing file is replaced', async () => {
  const dest = path.join(dir, 'e.bin');
  writeFileSync(dest, 'garbage');
  await download(url, dest, { sha256: sha });
  assert.equal(await sha256File(dest), sha);
});
