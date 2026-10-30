import express from 'express';
import { mkdir, readFile, writeFile, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, HOST, PORT, DATA_DIR, WORK_DIR, TRANSLATOR, bin, isValidId, findWhisperModel } from './config.js';
import { run } from './exec.js';
import { analyzeAudio, transcribeSpeech } from './transcribe.js';
import { buildCards } from './segmenter.js';
import { LANGUAGES, findLanguage } from './languages.js';
import { openBrowser } from './open-browser.js';
import * as translator from './translator.js';
import * as gemini from './gemini.js';
import { router, geminiPaused, resetCooldown } from './ai.js';
import { DEFAULT_DEEPSEEK_MODEL } from './deepseek.js';
import { createFavorites, GRADES, isDue } from './favorites.js';
import { createAICache } from './ai-cache.js';
import { searchLibrary, sentencesOfCard } from './library.js';

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

// Gemini settings: the GEMINI_API_KEY / GEMINI_MODEL environment variables win over the values saved in settings.json
// AI settings. Gemini is used first; DeepSeek (optional) takes over when Gemini fails, e.g. when its quota is used up.
// Environment variables (or .env) win over the values saved in settings.json.
async function aiConfig() {
  const s = await readSettings();
  const apiKey = process.env.GEMINI_API_KEY || s.geminiApiKey || '';
  const dsKey = process.env.DEEPSEEK_API_KEY || s.deepseekApiKey || '';
  return {
    apiKey,
    source: process.env.GEMINI_API_KEY ? 'env' : s.geminiApiKey ? 'settings' : null,
    model: process.env.GEMINI_MODEL || s.geminiModel || gemini.DEFAULT_MODEL,
    deepseek: {
      apiKey: dsKey,
      source: process.env.DEEPSEEK_API_KEY ? 'env' : s.deepseekApiKey ? 'settings' : null,
      model: process.env.DEEPSEEK_MODEL || s.deepseekModel || DEFAULT_DEEPSEEK_MODEL
    },
    any: !!(apiKey || dsKey)
  };
}

const routerFor = (ai, prefer) => router({ gemini: { apiKey: ai.apiKey, model: ai.model }, deepseek: ai.deepseek, prefer });
const hint = (key) => (key ? `…${key.slice(-4)}` : null);

const levelOf = (s) => (gemini.LEVELS.includes(s.level) ? s.level : 'B1');

app.get('/api/settings', async (_req, res) => {
  const s = await readSettings();
  const ai = await aiConfig();
  res.json({
    targetLang: findLanguage(s.targetLang) ? s.targetLang : null,
    languages: LANGUAGES.map(({ code, name }) => ({ code, name })),
    level: levelOf(s),
    levels: gemini.LEVELS,
    translator: { installed: translator.modelInstalled(), running: await translator.isUp() },
    whisperModel: findWhisperModel() ? path.basename(findWhisperModel()) : null,
    // The key itself never leaves the server; only its last characters are shown
    ai: {
      configured: ai.any, // Vary and Study work with either provider
      source: ai.source, model: ai.model, keyHint: hint(ai.apiKey), wordMeanings: !!s.aiWordMeanings,
      gemini: { configured: !!ai.apiKey, source: ai.source, model: ai.model, keyHint: hint(ai.apiKey), paused: geminiPaused() },
      deepseek: { configured: !!ai.deepseek.apiKey, source: ai.deepseek.source, model: ai.deepseek.model, keyHint: hint(ai.deepseek.apiKey) }
    }
  });
});

app.put('/api/settings', async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if ('targetLang' in body) {
    if (!findLanguage(body.targetLang)) return res.status(400).json({ error: 'Unsupported language', code: 'BAD_LANG' });
    patch.targetLang = body.targetLang;
  }
  if ('level' in body) {
    if (!gemini.LEVELS.includes(body.level)) return res.status(400).json({ error: 'Unsupported level', code: 'BAD_LEVEL' });
    patch.level = body.level;
  }
  if ('geminiApiKey' in body) {
    const key = String(body.geminiApiKey ?? '').trim();
    if (key && !/^[\w.-]{20,200}$/.test(key)) return res.status(400).json({ error: 'This does not look like an API key', code: 'BAD_KEY' });
    patch.geminiApiKey = key || undefined;
  }
  if ('aiWordMeanings' in body) patch.aiWordMeanings = body.aiWordMeanings === true || undefined;
  if ('deepseekApiKey' in body) {
    const key = String(body.deepseekApiKey ?? '').trim();
    if (key && !/^[\w.-]{20,200}$/.test(key)) return res.status(400).json({ error: 'This does not look like an API key', code: 'BAD_KEY' });
    patch.deepseekApiKey = key || undefined;
  }
  if ('geminiModel' in body) {
    const model = String(body.geminiModel ?? '').trim();
    if (model && !/^[\w.-]{3,80}$/.test(model)) return res.status(400).json({ error: 'Invalid model name', code: 'BAD_MODEL' });
    patch.geminiModel = model || undefined;
  }
  await writeSettings(patch);
  res.json({ ok: true });
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

// Share of the whole job (0..1) that each step covers, so one bar can show the overall progress
const STEPS = { queued: [0, 0], title: [0, 0.03], download: [0.03, 0.35], extract: [0.35, 0.4], transcribe: [0.4, 0.95], segment: [0.95, 0.99] };

// "00:12" / "1:02:03" → seconds
const etaSeconds = (s) => (/^[\d:]+$/.test(s || '') ? s.split(':').reduce((a, x) => a * 60 + Number(x), 0) : null);

function setProgress(job, stage, fraction = 0, extra = {}) {
  const [a, b] = STEPS[stage] || [0, 0];
  job.stage = stage;
  job.progress = a + (b - a) * Math.max(0, Math.min(1, fraction));
  job.stageProgress = fraction;
  job.speed = extra.speed || null;
  job.eta = extra.eta ?? null;
}

// Parses yt-dlp's "[download]  45.3% of   35.10MiB at    2.50MiB/s ETA 00:10". It downloads the video and the audio one after
// the other; the video is most of the bytes, so it counts for 85 % of the step.
function downloadProgress(job) {
  let stream = 0;
  return (line) => {
    if (/^\[download\] Destination:/.test(line)) { stream += 1; return; }
    const m = /^\[download\]\s+([\d.]+)%(?:.*?\sat\s+([\d.]+\s?\S*\/s))?(?:.*?ETA\s+([\d:]+))?/.exec(line);
    if (!m) return;
    const pct = Number(m[1]) / 100;
    const fraction = stream <= 1 ? 0.85 * pct : 0.85 + 0.15 * pct;
    setProgress(job, 'download', fraction, { speed: m[2] || null, eta: etaSeconds(m[3]) });
  };
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

    setProgress(job, 'title');
    let title = url;
    try {
      const r = await run(bin.ytdlp, ['--get-title', '--no-playlist', '--', url]);
      title = (r.out || '').trim() || url;
    } catch { /* fall back to the link */ }
    job.title = title;

    setProgress(job, 'download');
    const onDownload = { onLine: downloadProgress(job) };
    try {
      // H.264 + AAC first: every browser plays it, and Whisper timed the audio of AV1 + Opus downloads wrongly in tests (a
      // music intro shifted the first sentences by 12 s). Other codecs only when a video has no H.264/AAC version.
      await run(bin.ytdlp, ['-f', 'bv*[height<=720][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=720][vcodec^=avc1][acodec^=mp4a]/bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4', '--newline', '--progress', '--no-playlist', '-o', videoPath, '--', url], onDownload);
    } catch {
      // On 403 and similar, retry with the Android client at lower quality
      await run(bin.ytdlp, ['-f', 'b', '--extractor-args', 'youtube:player_client=android', '--merge-output-format', 'mp4', '--force-overwrites', '--newline', '--progress', '--no-playlist', '-o', videoPath, '--', url], onDownload);
    }

    // Word-level transcript + silence map → cards whose sentences are never split (docs/SUBTITLE-CARDS.md)
    const started = Date.now();
    const { words, silences } = await analyzeAudio(videoPath, workBase, (stage) => setProgress(job, stage), (f) => {
      // time left: from how long the transcription has taken so far (useful after the first 5 %)
      const eta = f >= 0.05 ? Math.round(((Date.now() - started) * (1 - f)) / f / 1000) : null;
      setProgress(job, 'transcribe', f, { eta });
    });
    await writeFile(path.join(dir, 'words.json'), JSON.stringify({ words, silences }));
    const segments = buildCards(words, silences);
    if (!segments.length) throw new AppError('NO_SPEECH', 'No speech was found in the video.');

    const project = { id: jobId, title, url, createdAt: new Date().toISOString(), segments };
    await writeFile(projectFile(jobId), JSON.stringify(project, null, 2));

    job.status = 'done';
    job.stage = 'done';
    job.progress = 1;
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
  res.json({
    id: job.id, status: job.status, stage: job.stage, error: job.error, code: job.code, project: job.project,
    title: job.title, progress: job.progress ?? 0, stageProgress: job.stageProgress ?? 0, speed: job.speed, eta: job.eta
  });
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

// Meaning of one clicked word: GET /api/word?w=trunks&s=<the sentence>
// The local model (HY-MT) translates the word. Only if the user turned on "Gemini for word meanings" in Settings
// is Gemini asked for the meaning in this sentence (falling back to the local model if Gemini fails).
app.get('/api/word', async (req, res) => {
  const w = String(req.query.w || '').trim();
  const sentence = String(req.query.s || '').trim().slice(0, 500);
  if (!w || w.length > 40 || !/^[\p{L}][\p{L}'’-]*$/u.test(w)) return res.status(400).json({ error: 'Invalid word', code: 'BAD_WORD' });
  let aiError = null;
  try {
    const lang = await targetLang();
    const ai = await aiConfig();
    const settings = await readSettings();
    if (ai.any && sentence && settings.aiWordMeanings) {
      try {
        const level = levelOf(settings);
        const key = aiCache.keyOf(['word', lang, level, w.toLowerCase(), sentence]);
        const cached = await aiCache.get(key);
        if (cached) return res.json({ ...cached, source: cached.provider || 'gemini' });
        const r = routerFor(ai);
        const result = { ...(await gemini.wordInContext({ generate: r.generate, word: w, sentence, lang, level })), provider: r.used.provider };
        await aiCache.set(key, result);
        return res.json({ ...result, source: result.provider });
      } catch (e) {
        if (!(e instanceof gemini.AIError) || !translator.modelInstalled() || ['AI_KEY_INVALID', 'AI_MODEL'].includes(e.code)) throw e;
        aiError = e.code; // fall back to the local model below
      }
    }
    await translator.ensureTranslator();
    res.json({ ...(await translator.translateWord(w, lang)), source: 'local', ...(aiError ? { fallback: aiError } : {}) });
  } catch (e) {
    sendError(res, e.code ? e : Object.assign(e, { status: 503, code: 'TRANSLATOR_FAILED' }));
  }
});

/* ---------- AI: Vary ---------- */

const aiCache = createAICache(DATA_DIR);

// POST /api/ai/vary { text, context?, more? } → { pattern, explanation, examples: [{ en, tr }], library: [...] }
// The answer is cached per sentence, language and level; `more: true` asks for new examples and appends them.
app.post('/api/ai/vary', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const context = String(req.body?.context || '').trim().slice(0, 500);
  if (!text || text.length > 400) return res.status(400).json({ error: 'Invalid sentence', code: 'BAD_TEXT' });
  try {
    const lang = await targetLang();
    const ai = await aiConfig();
    const level = levelOf(await readSettings());
    const key = aiCache.keyOf(['vary', 2, lang, level, text]); // 2: pattern named in the learner's language, foreign quotations ignored
    let result = await aiCache.get(key);
    if (!result || req.body?.more) {
      const exclude = (result?.examples || []).map((e) => e.en.replace(/\[\[|\]\]/g, ''));
      const r = routerFor(ai);
      const fresh = await gemini.vary({ generate: r.generate, sentence: text, context, lang, level, exclude });
      result = result ? { ...result, examples: [...result.examples, ...fresh.examples], provider: r.used.provider } : { ...fresh, provider: r.used.provider };
      await aiCache.set(key, result);
    }
    const library = await searchLibrary(DATA_DIR, result.search || [], { exclude: text, limit: 5 });
    res.json({ ...result, level, library });
  } catch (e) {
    sendError(res, e);
  }
});

// POST /api/ai/drill { text, context?, fresh? } → { pattern, explanation, notes: [{ title, explanation, example: { en, tr } }], steps: [{ label, native, en, alternatives, hint }], level }
// A speaking ladder for 🎯 Study. Cached per sentence, language and level; `fresh: true` makes a new set.
app.post('/api/ai/drill', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const context = String(req.body?.context || '').trim().slice(0, 500);
  if (!text || text.length > 400) return res.status(400).json({ error: 'Invalid sentence', code: 'BAD_TEXT' });
  try {
    const lang = await targetLang();
    const ai = await aiConfig();
    const level = levelOf(await readSettings());
    const key = aiCache.keyOf(['drill', 3, lang, level, text]); // 3: sentence-length steps + grammar notes (2: English-first ladders); older ones are not reused
    let result = req.body?.fresh ? null : await aiCache.get(key);
    if (!result) {
      const r = routerFor(ai);
      result = { ...(await gemini.drill({ generate: r.generate, sentence: text, context, lang, level })), provider: r.used.provider };
      await aiCache.set(key, result);
    }
    res.json({ ...result, level });
  } catch (e) {
    sendError(res, e);
  }
});

/* ---------- Speech (🎯 Study): transcribe the learner locally with Whisper ---------- */

let speechQueue = Promise.resolve(); // one recording at a time
app.post('/api/speech', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 200) return res.status(400).json({ error: 'No audio received', code: 'BAD_AUDIO' });
  const base = path.join(WORK_DIR, `speech-${crypto.randomUUID()}`);
  const job = speechQueue.then(async () => {
    await mkdir(WORK_DIR, { recursive: true });
    await writeFile(`${base}.input`, req.body);
    try {
      return await transcribeSpeech(`${base}.input`, base);
    } finally {
      await unlink(`${base}.input`).catch(() => {});
    }
  });
  speechQueue = job.catch(() => {});
  try {
    res.json(await job);
  } catch (e) {
    sendError(res, e.code ? e : Object.assign(e, { status: 500, code: 'SPEECH_FAILED' }));
  }
});

// Checks that the configured key and model work (used by the Settings dialog)
// { provider: 'gemini' | 'deepseek' } tests that one provider; a successful Gemini test also ends a quota pause
app.post('/api/ai/test', async (req, res) => {
  const prefer = req.body?.provider === 'deepseek' ? 'deepseek' : 'gemini';
  try {
    const ai = await aiConfig();
    const r = routerFor(ai, prefer);
    await gemini.wordInContext({ generate: r.generate, word: 'test', sentence: 'This is a test.', lang: (await readSettings()).targetLang || 'tr' });
    if (prefer === 'gemini') resetCooldown();
    res.json({ ok: true, provider: prefer, model: prefer === 'deepseek' ? ai.deepseek.model : ai.model });
  } catch (e) {
    sendError(res, e);
  }
});

/* ---------- Favorites & review ---------- */

const favorites = createFavorites(DATA_DIR);
app.param('fid', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'Invalid id', code: 'BAD_ID' })));

app.get('/api/favorites', async (_req, res) => {
  const items = await favorites.list();
  const now = Date.now();
  res.json({ items, due: items.filter((x) => isDue(x, now)).length });
});

// Save a sentence of a video ({ projectId, cardIndex, sentIndex }) or a generated example ({ kind: 'example', text, tr, pattern })
app.post('/api/favorites', async (req, res) => {
  const b = req.body || {};
  try {
    if (b.kind === 'example' || b.kind === 'drill') {
      const text = String(b.text || '').trim();
      const tr = String(b.tr || '').trim();
      if (!text || text.length > 400 || tr.length > 600) return res.status(400).json({ error: 'Invalid example', code: 'BAD_TEXT' });
      const item = await favorites.add({ kind: b.kind, text, tr, lang: (await readSettings()).targetLang || null, pattern: String(b.pattern || '').slice(0, 200), source: String(b.source || '').slice(0, 400) });
      return res.json(item);
    }
    if (!isValidId(b.projectId) || !Number.isInteger(b.cardIndex) || !Number.isInteger(b.sentIndex)) return res.status(400).json({ error: 'Invalid sentence reference', code: 'BAD_TEXT' });
    const project = await loadProject(b.projectId);
    const card = project.segments[b.cardIndex];
    const sentence = card && sentencesOfCard(card)[b.sentIndex];
    if (!sentence) return res.status(404).json({ error: 'Sentence not found', code: 'NOT_FOUND' });
    const item = await favorites.add({
      kind: 'video', projectId: project.id, title: project.title, cardIndex: b.cardIndex, sentIndex: b.sentIndex,
      text: sentence.text, tr: sentence.tr, lang: project.trLang || null, start: sentence.start, end: sentence.end
    });
    res.json(item);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });
    sendError(res, e);
  }
});

app.delete('/api/favorites/:fid', async (req, res) => {
  await favorites.remove(req.params.fid);
  res.json({ ok: true });
});

app.post('/api/favorites/:fid/review', async (req, res) => {
  const grade = req.body?.grade;
  if (!GRADES.includes(grade)) return res.status(400).json({ error: 'Invalid grade', code: 'BAD_GRADE' });
  const item = await favorites.review(req.params.fid, grade);
  if (!item) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  res.json(item);
});

// Tab-separated export that Anki (File → Import) and spreadsheets understand
app.get('/api/favorites/export.tsv', async (_req, res) => {
  const cell = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const rows = (await favorites.list()).map((x) => [
    cell(x.text), cell(x.tr),
    cell(x.kind === 'video' ? `${x.title} @ ${time(x.start)}` : `Example · ${x.pattern || ''}`)
  ].join('\t'));
  res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="yt-altyazi-favorites.tsv"');
  res.send(['#separator:tab', '#html:false', ...rows].join('\n') + '\n');
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
