// HY-MT1.5-1.8B translation client + management of the local llama-server.
// Install: `npm run setup`, server: `npm run translator -- start|stop|status|logs|test` — docs/TRANSLATION.md
import { spawn } from 'node:child_process';
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { TRANSLATOR, bin, which, IS_WINDOWS } from './config.js';
import { findLanguage } from './languages.js';

// Sampling settings recommended by the model card
const SAMPLING = { temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05 };

// Splits text into sentences (the interface uses the same rule: public/app.js → splitSentences)
export const splitSentences = (t) => t.split(/(?<=[.?!…])\s+/).map((x) => x.trim()).filter(Boolean);

export function modelInstalled() {
  return existsSync(TRANSLATOR.modelPath);
}

export async function isUp() {
  try {
    const r = await fetch(`${TRANSLATOR.url}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/* ---------- Server management (llama-server) ---------- */

const pidFile = path.join(TRANSLATOR.stateDir, 'server.pid');
export const logFile = path.join(TRANSLATOR.stateDir, 'server.log');
const readPid = () => { try { return Number(readFileSync(pidFile, 'utf8')) || null; } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Starts the server in the background (does nothing if it is already up). It keeps running when the app exits; stop it with `stopServer`.
export async function startServer() {
  if (await isUp()) return { started: false };
  if (!modelInstalled()) throw new Error('The translation model is not installed. Run: npm run setup');
  if (!which(bin.llamaServer)) throw new Error('llama-server was not found. Install llama.cpp (see docs/INSTALL.md) or set LLAMA_SERVER_BIN.');

  mkdirSync(TRANSLATOR.stateDir, { recursive: true });
  const log = openSync(logFile, 'w');
  const args = [
    '-m', TRANSLATOR.modelPath, '--alias', 'hy-mt', '--host', '127.0.0.1', '--port', String(TRANSLATOR.port),
    '-ngl', '99', // offload to the GPU (ignored when there is none)
    '-c', String(TRANSLATOR.parallel * 2048), '-np', String(TRANSLATOR.parallel), '--jinja'
  ];
  const child = spawn(bin.llamaServer, args, { detached: true, stdio: ['ignore', log, log], windowsHide: true });
  closeSync(log);
  const spawnError = new Promise((_, reject) => child.once('error', reject));
  child.unref();
  writeFileSync(pidFile, String(child.pid));

  const ready = (async () => {
    for (let i = 0; i < 90; i++) {
      if (await isUp()) return;
      if (!alive(child.pid)) throw new Error(`llama-server exited unexpectedly. See ${logFile}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`llama-server did not become ready within 90 s. See ${logFile}`);
  })();
  await Promise.race([ready, spawnError]);
  return { started: true, pid: child.pid };
}

export async function stopServer() {
  const pid = readPid();
  if (!pid || !alive(pid)) { rmSync(pidFile, { force: true }); return false; }
  process.kill(pid);
  rmSync(pidFile, { force: true });
  return true;
}

let starting = null;
// Starts the server when a translation is needed (concurrent calls share one start)
export function ensureTranslator() {
  starting ??= startServer().finally(() => { starting = null; });
  return starting;
}

/* ---------- Translation ---------- */

// The model's official prompt template for the target language. Chinese targets need the Chinese template (ZH<=>XX), all others XX<=>XX.
function buildPrompt(text, lang) {
  const l = findLanguage(lang);
  if (!l) throw new Error(`Unsupported target language: ${lang}`);
  if (l.zh) return `将以下文本翻译为${l.zh}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`;
  return `Translate the following segment into ${l.name}, without additional explanation.\n\n${text}`;
}

// Note: the model's official contextual template was tried but is not used: it copied the context lines into the output (docs/TRANSLATION.md).
export async function translate(text, lang) {
  const r = await fetch(`${TRANSLATOR.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'hy-mt',
      max_tokens: 768,
      ...SAMPLING,
      messages: [{ role: 'user', content: buildPrompt(text, lang) }]
    }),
    signal: AbortSignal.timeout(90_000)
  });
  if (!r.ok) throw new Error(`Translation server ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return String(data.choices?.[0]?.message?.content ?? '').trim();
}

// Translates a card sentence by sentence; for multi-sentence cards it returns `parts`, so the interface can pair every English
// sentence with its translation and show them in the same colour.
export async function translateLine(text, lang, sentences = splitSentences(text)) {
  if (sentences.length < 2) return { tr: await translate(text, lang) };
  const parts = [];
  for (const s of sentences) parts.push(await translate(s, lang));
  return { tr: parts.join(' '), parts };
}

const CONTRACTIONS = {
  "i'm": 'I am', "i've": 'I have', "i'll": 'I will', "i'd": 'I would', "you're": 'you are', "you've": 'you have',
  "you'll": 'you will', "he's": 'he is', "she's": 'she is', "it's": 'it is', "we're": 'we are', "they're": 'they are',
  "that's": 'that is', "there's": 'there is', "what's": 'what is', "let's": 'let us', "don't": 'do not',
  "doesn't": 'does not', "didn't": 'did not', "can't": 'cannot', "won't": 'will not', "isn't": 'is not',
  "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "couldn't": 'could not',
  "wouldn't": 'would not', "shouldn't": 'should not', "haven't": 'have not', "hasn't": 'has not'
};
const wordCache = new Map();

// Meaning of a single word (translated on its own, so it is independent of context).
// Contractions ("don't") give nonsense in the model, so they are expanded first.
export async function translateWord(word, lang) {
  const key = `${lang}:${word.toLowerCase().replace(/’/g, "'")}`;
  if (wordCache.has(key)) return wordCache.get(key);
  const contraction = CONTRACTIONS[key.slice(lang.length + 1)];
  let tr = (await translate(contraction || word, lang)).replace(/[.…!。]+$/, '').trim();
  if (word[0] === word[0].toLowerCase()) tr = tr.charAt(0).toLocaleLowerCase(lang.startsWith('zh') ? 'zh' : lang) + tr.slice(1);
  const result = { word, expanded: contraction || null, tr };
  if (wordCache.size > 5000) wordCache.clear();
  wordCache.set(key, result);
  return result;
}
