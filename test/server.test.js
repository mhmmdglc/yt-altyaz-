import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fake Gemini endpoint for the AI routes
const geminiCalls = [];
let geminiReply = null;
const fakeGemini = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    geminiCalls.push({ url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body || '{}') });
    const { status, obj, delay = 0 } = geminiReply(geminiCalls.at(-1));
    setTimeout(() => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } : obj));
    }, delay);
  });
});
await new Promise((r) => fakeGemini.listen(0, '127.0.0.1', r));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ytaltyazi-'));
const children = [];
test.after(() => { children.forEach((c) => c.kill()); fakeGemini.close(); rmSync(tmp, { recursive: true, force: true }); });

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer(dataDir = path.join(tmp, `data-${children.length}`)) {
  mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WORK_DIR: path.join(tmp, 'work'), HYMT_PORT: String(await freePort()), HYMT_MODEL_DIR: path.join(tmp, 'no-model'), DOTENV_PATH: path.join(tmp, 'no.env'), DEEPSEEK_API_KEY: '', DEEPSEEK_MODEL: '', GEMINI_API_KEY: '', GEMINI_MODEL: '', GEMINI_API_BASE: `http://127.0.0.1:${fakeGemini.address().port}` },
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
    for (const [method, suffix] of [['DELETE', ''], ['GET', ''], ['GET', '/video'], ['POST', '/translate'], ['GET', '/translate'], ['POST', '/ai-split'], ['GET', '/ai-split'], ['DELETE', '/ai-split'], ['PUT', '/split']]) {
      const r = await request(server.port, method, `/api/project/${evil}${suffix}`, ['POST', 'PUT'].includes(method) ? { body: { mode: 'ai' } } : {});
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

/* ---------- AI and favorites ---------- */

const KEY = 'AIzaSyTEST-1234567890abcdefWXYZ';

function writeProject(dataDir, id, segments) {
  mkdirSync(path.join(dataDir, id), { recursive: true });
  writeFileSync(path.join(dataDir, id, 'project.json'), JSON.stringify({ id, title: 'Talk', url: 'https://example.com', createdAt: '2026-01-01T00:00:00Z', trLang: 'tr', segments }));
}

test('the Gemini key can be saved but is never sent back to the browser', async () => {
  const srv = await startServer();
  assert.equal((await request(srv.port, 'PUT', '/api/settings', { body: { geminiApiKey: 'short' } })).status, 400);
  assert.equal((await request(srv.port, 'PUT', '/api/settings', { body: { geminiApiKey: KEY, level: 'B2' } })).status, 200);
  const s = await request(srv.port, 'GET', '/api/settings');
  assert.equal(s.json.ai.configured, true);
  assert.equal(s.json.ai.keyHint, '…WXYZ');
  assert.equal(s.json.level, 'B2');
  assert.ok(!s.text.includes(KEY), 'the full key must not appear in any response');
  assert.equal((await request(srv.port, 'PUT', '/api/settings', { body: { level: 'Z9' } })).status, 400);
  await request(srv.port, 'PUT', '/api/settings', { body: { geminiApiKey: '' } });
  assert.equal((await request(srv.port, 'GET', '/api/settings')).json.ai.configured, false);
});

test('Vary: needs a key, returns examples and real library matches, and caches the answer', async () => {
  const srv = await startServer();
  writeProject(srv.dataDir, ID, [
    { start: 0, end: 3, text: "I'm not good at accounting.", sents: ["I'm not good at accounting."], sentTimes: [[0, 3]], tr: 'Muhasebede iyi değilim.' },
    { start: 3, end: 6, text: 'He is good at chess.', sents: ['He is good at chess.'], sentTimes: [[3, 6]], tr: 'Satrançta iyi.' }
  ]);
  await request(srv.port, 'PUT', '/api/settings', { body: { targetLang: 'tr' } });
  const noKey = await request(srv.port, 'POST', '/api/ai/vary', { body: { text: "I'm not good at accounting." } });
  assert.equal(noKey.status, 409);
  assert.equal(noKey.json.code, 'NO_AI_KEY');

  await request(srv.port, 'PUT', '/api/settings', { body: { geminiApiKey: KEY } });
  let n = 0;
  geminiReply = () => ({ status: 200, obj: { pattern: 'be (not) good at + -ing', explanation: 'Açıklama.', examples: [{ en: `Example ${++n} [[good at]] it.`, translation: `Örnek ${n}` }], search: ['good at'] } });
  geminiCalls.length = 0;
  const first = await request(srv.port, 'POST', '/api/ai/vary', { body: { text: "I'm not good at accounting." } });
  assert.equal(first.status, 200);
  assert.equal(first.json.examples.length, 1);
  assert.deepEqual(first.json.library.map((h) => h.text), ['He is good at chess.'], 'the studied sentence itself is not listed');
  assert.equal(geminiCalls[0].key, KEY);

  const cached = await request(srv.port, 'POST', '/api/ai/vary', { body: { text: "I'm not good at accounting." } });
  assert.equal(geminiCalls.length, 1, 'the second request is served from the cache');
  assert.deepEqual(cached.json.examples, first.json.examples);

  const more = await request(srv.port, 'POST', '/api/ai/vary', { body: { text: "I'm not good at accounting.", more: true } });
  assert.equal(more.json.examples.length, 2);
  assert.match(geminiCalls[1].body.contents[0].parts[0].text, /Do not repeat any of these sentences: "Example 1 good at it\."/);
});

test('word meanings stay on the local model by default; Gemini only when turned on', async () => {
  const srv = await startServer();
  await request(srv.port, 'PUT', '/api/settings', { body: { targetLang: 'tr', geminiApiKey: KEY } });
  geminiReply = () => ({ status: 200, obj: { lemma: 'trunk', pos: 'isim', meaning: 'hortum', note: '' } });
  geminiCalls.length = 0;
  const local = await request(srv.port, 'GET', `/api/word?w=trunks&s=${encodeURIComponent('Elephants have long trunks.')}`);
  assert.equal(geminiCalls.length, 0, 'a key alone does not send words to Gemini');
  assert.equal(local.json.code, 'TRANSLATOR_FAILED', 'the local model is used (and is not installed in the test)');
  assert.equal((await request(srv.port, 'GET', '/api/settings')).json.ai.wordMeanings, false);

  await request(srv.port, 'PUT', '/api/settings', { body: { aiWordMeanings: true } });
  const r = await request(srv.port, 'GET', `/api/word?w=trunks&s=${encodeURIComponent('Elephants have long trunks.')}`);
  assert.equal(r.json.tr, 'hortum');
  assert.equal(r.json.source, 'gemini');
  geminiReply = () => ({ status: 429, obj: { error: { message: 'Resource has been exhausted' } } });
  const q = await request(srv.port, 'GET', `/api/word?w=chess&s=${encodeURIComponent('He plays chess.')}`);
  assert.equal(q.status, 429);
  assert.equal(q.json.code, 'AI_QUOTA');
});

test('favorites: save a video sentence with its own times, an example, review, export and delete', async () => {
  const srv = await startServer();
  writeProject(srv.dataDir, ID, [
    { start: 0, end: 6, text: 'One here. Two there.', sents: ['One here.', 'Two there.'], sentTimes: [[0, 2.5], [2.6, 6]], tr: 'Bir. İki.', trParts: ['Bir.', 'İki.'] }
  ]);
  const add = await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 0, sentIndex: 1 } });
  assert.equal(add.status, 200);
  assert.deepEqual([add.json.text, add.json.tr, add.json.start, add.json.end], ['Two there.', 'İki.', 2.6, 6]);
  const dup = await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 0, sentIndex: 1 } });
  assert.equal(dup.json.id, add.json.id);
  assert.equal((await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 0, sentIndex: 9 } })).status, 404);
  assert.equal((await request(srv.port, 'POST', '/api/favorites', { body: { projectId: '../x', cardIndex: 0, sentIndex: 0 } })).status, 400);

  const ex = await request(srv.port, 'POST', '/api/favorites', { body: { kind: 'example', text: 'She is good at\tchess.', tr: 'Satrançta iyi.', pattern: 'be good at' } });
  let list = await request(srv.port, 'GET', '/api/favorites');
  assert.equal(list.json.items.length, 2);
  assert.equal(list.json.due, 2, 'new favorites are due for review right away');

  const reviewed = await request(srv.port, 'POST', `/api/favorites/${ex.json.id}/review`, { body: { grade: 'good' } });
  assert.equal(reviewed.json.review.interval, 1);
  assert.equal((await request(srv.port, 'POST', `/api/favorites/${ex.json.id}/review`, { body: { grade: 'perfect' } })).status, 400);
  list = await request(srv.port, 'GET', '/api/favorites');
  assert.equal(list.json.due, 1);

  const tsv = await request(srv.port, 'GET', '/api/favorites/export.tsv');
  const lines = tsv.text.trim().split('\n');
  assert.equal(lines[0], '#separator:tab');
  assert.ok(lines.includes('She is good at chess.\tSatrançta iyi.\tExample · be good at'), 'tabs inside a field are flattened');
  assert.ok(lines.includes('Two there.\tİki.\tTalk @ 0:02'));

  assert.equal((await request(srv.port, 'DELETE', `/api/favorites/${add.json.id}`)).status, 200);
  assert.equal((await request(srv.port, 'GET', '/api/favorites')).json.items.length, 1);
  assert.equal((await request(srv.port, 'DELETE', '/api/favorites/..%2F..')).status, 400);
});

test('speech endpoint rejects empty or tiny uploads (the transcription itself needs Whisper)', async () => {
  const srv = await startServer();
  const r = await request(srv.port, 'POST', '/api/speech', { headers: { 'Content-Type': 'audio/webm' }, body: undefined });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'BAD_AUDIO');
});

test('drill endpoint caches its ladder and favorites accept speaking sentences', async () => {
  const srv = await startServer();
  await request(srv.port, 'PUT', '/api/settings', { body: { targetLang: 'tr', geminiApiKey: KEY } });
  geminiCalls.length = 0;
  geminiReply = () => ({ status: 200, obj: { pattern: 'p', explanation: 'e', steps: [
    { label: 'a', native: 'Gidiyorum.', en: "I'm going.", alternatives: [], hint: '' },
    { label: 'b', native: 'Gidiyorsun.', en: "You're going.", alternatives: [], hint: '' },
    { label: 'c', native: 'Gitmiyorum.', en: "I'm not going.", alternatives: [], hint: '' }
  ] } });
  const first = await request(srv.port, 'POST', '/api/ai/drill', { body: { text: "I'm going to Istanbul." } });
  assert.equal(first.json.steps.length, 3);
  await request(srv.port, 'POST', '/api/ai/drill', { body: { text: "I'm going to Istanbul." } });
  assert.equal(geminiCalls.length, 1, 'cached');
  await request(srv.port, 'POST', '/api/ai/drill', { body: { text: "I'm going to Istanbul.", fresh: true } });
  assert.equal(geminiCalls.length, 2, 'a new set asks again');

  const fav = await request(srv.port, 'POST', '/api/favorites', { body: { kind: 'drill', text: "I'm not going.", tr: 'Gitmiyorum.', pattern: 'p' } });
  assert.equal(fav.json.kind, 'drill');
  const again = await request(srv.port, 'POST', '/api/favorites', { body: { kind: 'drill', text: "I'm not going.", tr: 'Gitmiyorum.' } });
  assert.equal(again.json.id, fav.json.id);
});

/* ---------- AI split ---------- */

const { buildCards } = await import('../segmenter.js');

// A small talk with a non-speech annotation; words 0.4 s apart with pauses after the sentences
function writeTalk(dataDir, id) {
  const text = 'At this point Musa (speaking in foreign language) He actually, this is what the first command was that Allah gave Musa. ' +
    'He said, "Yeah Allah, before I do it, I need some help." And so now we are learning that when Allah tells us to do something, it is hard.';
  let t = 0;
  const silences = [];
  const words = text.split(' ').map((w) => {
    const word = { w, s: +t.toFixed(2), e: +(t + 0.35).toFixed(2) };
    t += 0.4;
    if (/[.?!"]$/.test(w)) { silences.push({ a: +(word.e + 0.02).toFixed(2), b: +(word.e + 0.8).toFixed(2) }); t += 0.8; }
    return word;
  });
  const segments = buildCards(words, silences).map((c, k) => ({ ...c, tr: `yerel ${k}` }));
  mkdirSync(path.join(dataDir, id), { recursive: true });
  writeFileSync(path.join(dataDir, id, 'words.json'), JSON.stringify({ words, silences }));
  writeFileSync(path.join(dataDir, id, 'project.json'), JSON.stringify({ id, title: 'Talk', url: 'https://example.com', createdAt: '2026-01-01T00:00:00Z', trLang: 'tr', segments }, null, 2));
  return { words, segments };
}

// The fake AI splits the transcript at ‖ and then every 5 words
const splitReply = (delay = 0) => (call) => {
  const prompt = call.body.contents[0].parts[0].text;
  const text = /TRANSCRIPT TO SPLIT:\n(.*)/.exec(prompt)[1];
  const pieces = [];
  for (const run of text.split(' ‖ ')) {
    const ws = run.split(' ');
    for (let i = 0; i < ws.length; i += 5) pieces.push({ en: ws.slice(i, i + 5).join(' '), tr: `parça: ${ws.slice(i, i + 5).join(' ')}` });
  }
  return { status: 200, obj: { pieces }, delay };
};

async function waitSplit(port, id) {
  for (let i = 0; i < 100; i++) {
    const st = await request(port, 'GET', `/api/project/${id}/ai-split`);
    if (st.json.status !== 'running') return st.json;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the split did not finish');
}

test('AI split: needs a key, runs in the background, is saved, and the view can be switched', async () => {
  const srv = await startServer();
  const { words, segments } = writeTalk(srv.dataDir, ID);
  const projectFile = path.join(srv.dataDir, ID, 'project.json');
  await request(srv.port, 'PUT', '/api/settings', { body: { targetLang: 'tr' } });
  const noKey = await request(srv.port, 'POST', `/api/project/${ID}/ai-split`);
  assert.equal(noKey.status, 409);
  assert.equal(noKey.json.code, 'NO_AI_KEY');
  assert.equal((await request(srv.port, 'POST', '/api/project/99999999-0000-0000-0000-000000000000/ai-split')).status, 404);

  await request(srv.port, 'PUT', '/api/settings', { body: { geminiApiKey: KEY } });
  geminiCalls.length = 0;
  geminiReply = splitReply(150);
  const start = await request(srv.port, 'POST', `/api/project/${ID}/ai-split`);
  assert.equal(start.json.status, 'running');
  const busy = await request(srv.port, 'POST', `/api/project/${ID}/ai-split`);
  assert.equal(busy.status, 409, 'one split at a time per video');
  assert.equal(busy.json.code, 'AI_SPLIT_RUNNING');
  const done = await waitSplit(srv.port, ID);
  assert.equal(done.status, 'done');
  assert.equal(done.done, done.total);
  assert.ok(!geminiCalls.some((c) => c.body.contents[0].parts[0].text.split('TRANSCRIPT TO SPLIT:')[1].includes('speaking in foreign')));
  assert.equal(geminiCalls[0].body.generationConfig.temperature, 0.2);

  const saved = JSON.parse(readFileSync(path.join(srv.dataDir, ID, 'ai-split.json'), 'utf8'));
  assert.equal(saved.lang, 'tr');
  assert.equal(saved.level, 'B1');
  assert.equal(saved.provider, 'gemini');
  assert.match(saved.wordsHash, /^[0-9a-f]{16}$/);
  assert.deepEqual(JSON.parse(readFileSync(projectFile, 'utf8')).segments, segments, 'the original cards are untouched');

  // The finished split is shown; the original cards are one switch away
  let p = (await request(srv.port, 'GET', `/api/project/${ID}`)).json;
  assert.equal(p.split, 'ai');
  assert.equal(p.hasAiSplit, true);
  assert.equal(p.aiSplitStale, false);
  assert.deepEqual(p.segments, saved.cards);
  assert.ok(p.segments.every((c) => c.tr.startsWith('parça: ') && !c.text.includes('speaking')));
  assert.equal(p.segments.map((c) => c.text).join(' ').split(' ').length, words.length - 4, 'every spoken word, the annotation dropped');
  for (let k = 1; k < p.segments.length; k++) assert.ok(p.segments[k].start >= p.segments[k - 1].end);

  assert.equal((await request(srv.port, 'PUT', `/api/project/${ID}/split`, { body: { mode: 'sideways' } })).status, 400);
  assert.equal((await request(srv.port, 'PUT', `/api/project/${ID}/split`, { body: { mode: 'original' } })).json.split, 'original');
  p = (await request(srv.port, 'GET', `/api/project/${ID}`)).json;
  assert.equal(p.split, 'original');
  assert.deepEqual(p.segments, segments);
  assert.equal(p.hasAiSplit, true);
  assert.deepEqual((await request(srv.port, 'GET', `/api/project/${ID}?view=ai`)).json.segments, saved.cards, 'one view on request');
  assert.equal((await request(srv.port, 'GET', `/api/project/${ID}`)).json.split, 'original', '…without changing the choice');
  const listed = (await request(srv.port, 'GET', '/api/projects')).json.find((x) => x.id === ID);
  assert.equal(listed.segmentCount, segments.length, 'the library counts the original cards');

  // A new transcript (npm run regroup -- <id> --whisper) makes the split stale, it is not deleted
  const w = JSON.parse(readFileSync(path.join(srv.dataDir, ID, 'words.json'), 'utf8'));
  w.words[0].e += 0.01;
  writeFileSync(path.join(srv.dataDir, ID, 'words.json'), JSON.stringify(w));
  p = (await request(srv.port, 'GET', `/api/project/${ID}?view=ai`)).json;
  assert.equal(p.aiSplitStale, true);
  assert.equal(p.split, 'ai');

  // Errors of the AI surface with their code
  geminiReply = () => ({ status: 429, obj: { error: { message: 'Resource has been exhausted' } } });
  await request(srv.port, 'POST', `/api/project/${ID}/ai-split`);
  const failed = await waitSplit(srv.port, ID);
  assert.equal(failed.status, 'error');
  assert.equal(failed.code, 'AI_QUOTA');
  assert.ok(existsSync(path.join(srv.dataDir, ID, 'ai-split.json')), 'a failed run keeps the previous split');

  assert.equal((await request(srv.port, 'DELETE', `/api/project/${ID}/ai-split`)).status, 200);
  assert.ok(!existsSync(path.join(srv.dataDir, ID, 'ai-split.json')));
  p = (await request(srv.port, 'GET', `/api/project/${ID}?view=ai`)).json;
  assert.equal(p.split, 'original');
  assert.equal(p.hasAiSplit, false);
  assert.equal((await request(srv.port, 'PUT', `/api/project/${ID}/split`, { body: { mode: 'ai' } })).json.code, 'NO_AI_SPLIT');
});

test('favorites keep their sentence across the original and AI views', async () => {
  const srv = await startServer();
  writeTalk(srv.dataDir, ID);
  await request(srv.port, 'PUT', '/api/settings', { body: { targetLang: 'tr', geminiApiKey: KEY } });
  geminiReply = splitReply();
  await request(srv.port, 'POST', `/api/project/${ID}/ai-split`);
  assert.equal((await waitSplit(srv.port, ID)).status, 'done');
  const ai = (await request(srv.port, 'GET', `/api/project/${ID}?view=ai`)).json.segments;
  const orig = (await request(srv.port, 'GET', `/api/project/${ID}?view=original`)).json.segments;

  const fromAi = await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 2, sentIndex: 0, view: 'ai' } });
  assert.equal(fromAi.status, 200);
  assert.deepEqual([fromAi.json.view, fromAi.json.text, fromAi.json.tr, fromAi.json.start, fromAi.json.end], ['ai', ai[2].text, ai[2].tr, ai[2].start, ai[2].end]);
  const fromOrig = await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 0, sentIndex: 0 } });
  assert.equal(fromOrig.json.view, 'original');
  assert.equal(fromOrig.json.text, orig[0].sents[0]);
  assert.notEqual(fromOrig.json.id, fromAi.json.id, 'same indexes, different views: different sentences');
  const again = await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 2, sentIndex: 0, view: 'ai' } });
  assert.equal(again.json.id, fromAi.json.id, 'no duplicates');
  assert.equal((await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 999, sentIndex: 0, view: 'ai' } })).status, 404);

  // Switching the view or redoing the split does not change what was saved
  await request(srv.port, 'PUT', `/api/project/${ID}/split`, { body: { mode: 'original' } });
  await request(srv.port, 'DELETE', `/api/project/${ID}/ai-split`);
  const items = (await request(srv.port, 'GET', '/api/favorites')).json.items;
  const kept = items.find((x) => x.id === fromAi.json.id);
  assert.deepEqual([kept.text, kept.start, kept.end], [ai[2].text, ai[2].start, ai[2].end]);
  assert.equal((await request(srv.port, 'POST', '/api/favorites', { body: { projectId: ID, cardIndex: 0, sentIndex: 0, view: 'ai' } })).status, 404, 'no AI split any more');
});
