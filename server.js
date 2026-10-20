import express from 'express';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, HOST, PORT, DATA_DIR, WORK_DIR, TRANSLATOR, bin, isValidId, findWhisperModel } from './config.js';
import { run } from './exec.js';
import { analyzeAudio } from './transcribe.js';
import { buildCards } from './segmenter.js';
import { LANGUAGES, findLanguage } from './languages.js';
import { openBrowser } from './open-browser.js';
import * as translator from './translator.js';

// Errors the UI knows how to translate carry a `code` (public/i18n.js → err.*)
class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const sendError = (res, e) =>
  res.status(e.status || 500).json({ error: e.message, code: e.code || 'INTERNAL' });

const app = express();
app.disable('x-powered-by');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const loopbackOnly = LOOPBACK.has(HOST);

// Local-app hardening. The API has no authentication, so by default we only serve this computer, and we
// reject requests whose Host/Origin is not us (blocks DNS-rebinding and cross-site requests from other web pages).
app.use((req, res, next) => {
  if (loopbackOnly) {
    const hostname = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!LOOPBACK.has(hostname)) return res.status(403).json({ error: 'Forbidden host', code: 'FORBIDDEN' });
  }
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* malformed Origin: stays empty and is rejected below */ }
    if (originHost !== req.headers.host) return res.status(403).json({ error: 'Forbidden origin', code: 'FORBIDDEN' });
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// Every :id in a route is validated before it can reach a file path (prevents "../" traversal)
app.param('id', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'Invalid id', code: 'BAD_ID' })));

const projectDir = (id) => path.join(DATA_DIR, id);
const projectFile = (id) => path.join(projectDir(id), 'project.json');

/* ---------- Settings (data/settings.json) ---------- */

const settingsFile = path.join(DATA_DIR, 'settings.json');

async function readSettings() {
  try { return JSON.parse(await readFile(settingsFile, 'utf8')); } catch { return {}; }
}

async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...patch };
  await writeFile(settingsFile, JSON.stringify(next, null, 2));
  return next;
}

// Existing installs (before the target language became a setting) translated to Turkish
async function migrateSettings() {
  if ((await readSettings()).targetLang) return;
  for (const e of await readdir(DATA_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !isValidId(e.name)) continue;
    try {
      const p = JSON.parse(await readFile(projectFile(e.name), 'utf8'));
      if (p.segments?.some((s) => s.tr)) return void (await writeSettings({ targetLang: 'tr' }));
    } catch { /* sonraki */ }
  }
}

async function targetLang() {
  const lang = (await readSettings()).targetLang;
  if (!findLanguage(lang)) throw new AppError('NO_LANG', 'Choose the language to translate into first.', 409);
  return lang;
}

async function loadProject(id) {
  const p = JSON.parse(await readFile(projectFile(id), 'utf8'));
  if (!p.trLang && p.segments.some((s) => s.tr)) p.trLang = 'tr'; // translated before trLang existed
  return p;
}

app.get('/api/settings', async (_req, res) => {
  const s = await readSettings();
  res.json({
    targetLang: findLanguage(s.targetLang) ? s.targetLang : null,
    languages: LANGUAGES.map(({ code, name }) => ({ code, name })),
    translator: { installed: translator.modelInstalled(), running: await translator.isUp() },
    whisperModel: findWhisperModel() ? path.basename(findWhisperModel()) : null
  });
});

app.put('/api/settings', async (req, res) => {
  const lang = req.body?.targetLang;
  if (!findLanguage(lang)) return res.status(400).json({ error: 'Unsupported language', code: 'BAD_LANG' });
  await writeSettings({ targetLang: lang });
  res.json({ ok: true, targetLang: lang });
});

/* ---------- Transcription ---------- */

const jobs = new Map();
let queue = Promise.resolve(); // one transcription at a time (Whisper is heavy)

// Everything that writes project.json (translation) goes through the same per-project lock
const locks = new Map();
function withLock(id, fn) {
  const next = (locks.get(id) || Promise.resolve()).then(fn, fn);
  locks.set(id, next.catch(() => {}));
  return next;
}

async function transcribeJob(jobId, url) {
  const job = jobs.get(jobId);
  const dir = projectDir(jobId);
  const videoPath = path.join(dir, 'video.mp4');
  const workBase = path.join(WORK_DIR, jobId);

  try {
    if (!findWhisperModel()) throw new AppError('NO_WHISPER', 'No Whisper model found. Run: npm run setup');
    await mkdir(dir, { recursive: true });
    await mkdir(WORK_DIR, { recursive: true });

    job.stage = 'title';
    let title = url;
    try {
      const r = await run(bin.ytdlp, ['--get-title', '--no-playlist', '--', url]);
      title = (r.out || '').trim() || url;
    } catch { /* fall back to the link */ }

    job.stage = 'download';
    try {
      await run(bin.ytdlp, ['-f', 'bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4', '--no-playlist', '-o', videoPath, '--', url]);
    } catch {
      // On 403 and similar, retry with the Android client at lower quality
      await run(bin.ytdlp, ['-f', 'b', '--extractor-args', 'youtube:player_client=android', '--merge-output-format', 'mp4', '--force-overwrites', '--no-playlist', '-o', videoPath, '--', url]);
    }

    // Word-level transcript + silence map → cards whose sentences are never split (docs/SUBTITLE-CARDS.md)
    const { words, silences } = await analyzeAudio(videoPath, workBase, (stage) => { job.stage = stage; });
    await writeFile(path.join(dir, 'words.json'), JSON.stringify({ words, silences }));
    const segments = buildCards(words, silences);
    if (!segments.length) throw new AppError('NO_SPEECH', 'No speech was found in the video.');

    const project = { id: jobId, title, url, createdAt: new Date().toISOString(), segments };
    await writeFile(projectFile(jobId), JSON.stringify(project, null, 2));

    job.status = 'done';
    job.stage = 'done';
    job.project = project;

    // Start translating in the background when a model and a target language are available
    // (on failure the UI offers a retry button)
    if (translator.modelInstalled()) startTranslation(project.id).catch(() => {});
  } catch (e) {
    job.status = 'error';
    job.stage = 'error';
    job.error = e.message;
    job.code = e.code;
  }
}

app.post('/api/transcribe', (req, res) => {
  const url = String(req.body?.url || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch { /* rejected right below */ }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Enter a valid video link (http/https).', code: 'BAD_URL' });
  }
  const id = crypto.randomUUID();
  const job = { id, status: 'queued', stage: 'queued', url };
  jobs.set(id, job);
  queue = queue.then(() => transcribeJob(id, url));
  res.json({ jobId: id });
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
  res.json({ id: job.id, status: job.status, stage: job.stage, error: job.error, code: job.code, project: job.project });
});

/* ---------- Translation ---------- */

// projectId -> { status: 'running'|'done'|'error', done, total, error }
const translations = new Map();
const TRANSLATE_CONCURRENCY = TRANSLATOR.parallel; // as many requests as the translation server has slots

async function startTranslation(id, { force = false } = {}) {
  const running = translations.get(id);
  if (running?.status === 'running') return running;

  const lang = await targetLang();
  const project = await loadProject(id);
  const state = { status: 'running', done: 0, total: 0, lang };
  translations.set(id, state);

  try {
    // A different target language invalidates the old translations: clear them first so a partial run can never mix languages
    if (project.trLang && project.trLang !== lang) {
      await withLock(id, async () => {
        const p = await loadProject(id);
        for (const s of p.segments) { delete s.tr; delete s.trParts; }
        p.trLang = lang;
        await writeFile(projectFile(id), JSON.stringify(p, null, 2));
      });
      project.segments.forEach((s) => { delete s.tr; delete s.trParts; });
    }
    const todo = project.segments.map((_, i) => i).filter((i) => force || !project.segments[i].tr);
    state.total = todo.length;
    if (!todo.length) { state.status = 'done'; return state; }

    (async () => {
      await translator.ensureTranslator();
      const results = {};
      let next = 0;
      let unsaved = 0;

      const flush = () => {
        const batch = { ...results };
        for (const k of Object.keys(results)) delete results[k];
        unsaved = 0;
        return withLock(id, async () => {
          const p = await loadProject(id);
          p.trLang = lang;
          for (const [i, { tr, parts }] of Object.entries(batch)) {
            if (!p.segments[i]) continue;
            p.segments[i].tr = tr;
            if (parts) p.segments[i].trParts = parts;
            else delete p.segments[i].trParts;
          }
          await writeFile(projectFile(id), JSON.stringify(p, null, 2));
        });
      };

      const worker = async () => {
        while (next < todo.length) {
          const i = todo[next++];
          results[i] = await translator.translateLine(project.segments[i].text, lang, project.segments[i].sents);
          state.done++;
          if (++unsaved >= 20) await flush();
        }
      };
      try {
        await Promise.all(Array.from({ length: TRANSLATE_CONCURRENCY }, worker));
      } finally {
        await flush().catch(() => {}); // keep finished lines even if a worker failed
      }
      state.status = 'done';
    })().catch((e) => {
      state.status = 'error';
      state.error = e.message;
    });
  } catch (e) {
    state.status = 'error';
    state.error = e.message;
  }
  return state;
}

app.get('/api/project/:id/translate', (req, res) => {
  res.json(translations.get(req.params.id) || { status: 'idle' });
});

app.post('/api/project/:id/translate', async (req, res) => {
  if (!translator.modelInstalled()) {
    return res.status(409).json({ error: 'The translation model is not installed. Run: npm run setup', code: 'NO_MODEL' });
  }
  try {
    res.json(await startTranslation(req.params.id, { force: !!req.body?.force }));
  } catch (e) {
    if (e.code) return sendError(res, e);
    res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });
  }
});

// Meaning of one clicked word: GET /api/word?w=remembering → { word, expanded, tr }
app.get('/api/word', async (req, res) => {
  const w = String(req.query.w || '').trim();
  if (!w || w.length > 40 || !/^[\p{L}][\p{L}'’-]*$/u.test(w)) return res.status(400).json({ error: 'Invalid word', code: 'BAD_WORD' });
  try {
    const lang = await targetLang();
    await translator.ensureTranslator();
    res.json(await translator.translateWord(w, lang));
  } catch (e) {
    sendError(res, e.code ? e : Object.assign(e, { status: 503, code: 'TRANSLATOR_FAILED' }));
  }
});

/* ---------- Projects ---------- */

app.get('/api/projects', async (_req, res) => {
  const entries = await readdir(DATA_DIR, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isValidId(e.name)) continue;
    try {
      const p = await loadProject(e.name);
      projects.push({
        id: p.id,
        title: p.title,
        url: p.url,
        createdAt: p.createdAt,
        segmentCount: p.segments.length,
        translated: p.segments.length > 0 && p.segments.every((s) => s.tr),
        trLang: p.trLang || null,
        duration: p.segments.length ? p.segments[p.segments.length - 1].end : 0
      });
    } catch { /* not a project folder */ }
  }
  projects.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json(projects);
});

app.get('/api/project/:id', async (req, res) => {
  try {
    res.json(await loadProject(req.params.id));
  } catch {
    res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });
  }
});

app.delete('/api/project/:id', async (req, res) => {
  try {
    translations.delete(req.params.id);
    await rm(projectDir(req.params.id), { recursive: true, force: true });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not delete', code: 'INTERNAL' });
  }
});

app.get('/api/project/:id/video', (req, res) => {
  res.sendFile('video.mp4', { root: projectDir(req.params.id) }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

/* ---------- Start ---------- */

await mkdir(DATA_DIR, { recursive: true });
await mkdir(WORK_DIR, { recursive: true });
await migrateSettings();

const url = `http://localhost:${PORT}`;
const server = app.listen(PORT, HOST, () => {
  console.log(`✅ YT Altyazı is running: ${url}`);
  if (!loopbackOnly) console.warn(`⚠️  Listening on ${HOST}: this app has no authentication, anyone who can reach this port can use it.`);
  if (process.argv.includes('--open')) openBrowser(url);
});
server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Port busy: if it is already this app, just open it
  const same = await fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
  console.log(same ? `ℹ️  Already running: ${url}` : `❌ Port ${PORT} is in use by another program. Try: PORT=3001 npm start`);
  if (same && process.argv.includes('--open')) openBrowser(url);
  process.exit(same ? 0 : 1);
});
