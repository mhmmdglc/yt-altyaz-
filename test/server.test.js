import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ytaltyazi-'));
const children = [];
test.after(() => { children.forEach((c) => c.kill()); rmSync(tmp, { recursive: true, force: true }); });

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer(dataDir = path.join(tmp, `data-${children.length}`)) {
  mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WORK_DIR: path.join(tmp, 'work'), HYMT_PORT: String(await freePort()), HYMT_MODEL_DIR: path.join(tmp, 'no-model') },
    stdio: 'ignore'
  });
  children.push(child);
  for (let i = 0; i < 50; i++) {
    if (await request(port, 'GET', '/api/settings').then((r) => r.status === 200, () => false)) return { port, dataDir };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

// node:http instead of fetch so that we can send arbitrary Host / Origin headers
function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch { /* not json */ } resolve({ status: res.statusCode, json, text: data }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const server = await startServer();
const ID = '11111111-2222-3333-4444-555555555555';

test('listens on the loopback interface by default', async () => {
  const { HOST } = await import('../config.js');
  assert.equal(HOST, '127.0.0.1');
});

test('path traversal through :id is rejected and nothing outside data/ is touched', async () => {
  const decoy = path.join(path.dirname(server.dataDir), 'decoy');
  mkdirSync(decoy, { recursive: true });
  writeFileSync(path.join(decoy, 'keep.txt'), 'x');
  for (const evil of ['..%2Fdecoy', '..', '%2e%2e%2fdecoy', 'a'.repeat(100), '..%5Cdecoy']) {
    for (const [method, suffix] of [['DELETE', ''], ['GET', ''], ['GET', '/video'], ['POST', '/translate'], ['GET', '/translate']]) {
      const r = await request(server.port, method, `/api/project/${evil}${suffix}`, method === 'POST' ? { body: {} } : {});
      assert.ok([400, 404].includes(r.status), `${method} ${evil}${suffix} → ${r.status}`);
    }
  }
  assert.ok(existsSync(path.join(decoy, 'keep.txt')), 'the decoy folder must survive');
});

test('requests with a foreign Host header are refused (DNS rebinding)', async () => {
  const r = await request(server.port, 'GET', '/api/projects', { headers: { Host: 'evil.example.com' } });
  assert.equal(r.status, 403);
  const ok = await request(server.port, 'GET', '/api/projects', { headers: { Host: `localhost:${server.port}` } });
  assert.equal(ok.status, 200);
});

test('state-changing requests from another origin are refused (CSRF)', async () => {
  const bad = await request(server.port, 'PUT', '/api/settings', { headers: { Origin: 'http://evil.example.com' }, body: { targetLang: 'de' } });
  assert.equal(bad.status, 403);
  const same = await request(server.port, 'PUT', '/api/settings', { headers: { Origin: `http://127.0.0.1:${server.port}` }, body: { targetLang: 'de' } });
  assert.equal(same.status, 200);
});

test('settings: language list, validation and persistence', async () => {
  const s = await request(server.port, 'GET', '/api/settings');
  assert.ok(s.json.languages.some((l) => l.code === 'tr' && l.name === 'Turkish'));
  assert.ok(s.json.languages.length >= 30);
  assert.equal((await request(server.port, 'PUT', '/api/settings', { body: { targetLang: 'klingon' } })).status, 400);
  await request(server.port, 'PUT', '/api/settings', { body: { targetLang: 'es' } });
  assert.equal((await request(server.port, 'GET', '/api/settings')).json.targetLang, 'es');
});

test('transcription only accepts http(s) links', async () => {
  for (const url of ['', 'not a url', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/x']) {
    const r = await request(server.port, 'POST', '/api/transcribe', { body: { url } });
    assert.equal(r.status, 400, `"${url}" should be refused`);
    assert.equal(r.json.code, 'BAD_URL');
  }
});

test('word lookup validates input and needs a target language', async () => {
  assert.equal((await request(server.port, 'GET', '/api/word?w=%3Cscript%3E')).status, 400);
  assert.equal((await request(server.port, 'GET', `/api/word?w=${'a'.repeat(60)}`)).status, 400);
  const fresh = await startServer();
  const r = await request(fresh.port, 'GET', '/api/word?w=hello');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'NO_LANG');
});

test('projects: listing, reading, deleting, and missing files', async () => {
  const dir = path.join(server.dataDir, ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: ID, title: 'Demo', url: 'https://example.com/v', createdAt: new Date().toISOString(), segments: [{ start: 0, end: 2, text: 'Hello.', sents: ['Hello.'] }] }));
  const list = await request(server.port, 'GET', '/api/projects');
  assert.deepEqual(list.json.map((p) => p.id), [ID]);
  assert.equal(list.json[0].translated, false);
  assert.equal((await request(server.port, 'GET', `/api/project/${ID}`)).json.title, 'Demo');
  assert.equal((await request(server.port, 'GET', `/api/project/${ID}/video`)).status, 404);
  assert.equal((await request(server.port, 'DELETE', `/api/project/${ID}`)).status, 200);
  assert.ok(!existsSync(dir));
  assert.equal((await request(server.port, 'GET', `/api/project/${ID}`)).status, 404);
});

test('an existing library that was translated before target languages existed is migrated to Turkish', async () => {
  const dataDir = path.join(tmp, 'legacy');
  mkdirSync(path.join(dataDir, ID), { recursive: true });
  writeFileSync(path.join(dataDir, ID, 'project.json'), JSON.stringify({ id: ID, title: 'Old', segments: [{ start: 0, end: 1, text: 'Hi.', tr: 'Merhaba.' }] }));
  const legacy = await startServer(dataDir);
  assert.equal((await request(legacy.port, 'GET', '/api/settings')).json.targetLang, 'tr');
  assert.equal((await request(legacy.port, 'GET', `/api/project/${ID}`)).json.trLang, 'tr');
});
