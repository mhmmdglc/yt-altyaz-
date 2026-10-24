#!/usr/bin/env node
// npm run setup — checks the tools, downloads the models. Safe to run again.
//
//   npm run setup                            interactive
//   npm run setup -- --yes                   no questions: Whisper medium.en, no translation model
//   npm run setup -- --whisper small.en      choose the Whisper model: medium.en | small.en | base.en
//   npm run setup -- --translator --accept-hymt-license   also download the translation model (1.9 GB)
//   npm run setup -- --no-translator         skip the translation model question
//   npm run setup -- --shortcut              also put a shortcut on the Desktop (asked at the end when interactive)
//   npm run setup -- --no-shortcut           never ask about the shortcut
import { createInterface } from 'node:readline/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { MODELS_DIR, WHISPER_MODELS, whisperModelUrl, findWhisperModel, TRANSLATOR, which } from '../config.js';
import { download, huggingFaceSha256 } from './lib/download.mjs';
import { checkEnvironment, printChecks, platformInstallHelp } from './lib/checks.mjs';
import { modelInstalled } from '../translator.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const interactive = process.stdin.isTTY && !flag('yes');
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = async (q, def) => {
  if (!rl) return def;
  const a = (await rl.question(`${q} `)).trim();
  return a === '' ? def : a;
};
const yes = (a) => /^(y|yes|e|evet)$/i.test(a);

console.log('\nYT Altyazı — setup\n');

/* 1) tools */
let results = checkEnvironment();
printChecks(results);
const missingTools = results.filter((r) => !r.ok && r.required && !['Whisper model', 'Node.js ≥ 20'].includes(r.name));
const missingTranslatorTool = !results.find((r) => r.name.startsWith('llama-server')).ok;

if (missingTools.length || missingTranslatorTool) {
  const help = platformInstallHelp();
  console.log(`\nSome tools are missing. Install them with:\n\n  ${help.command}\n${help.note ? `\n  ${help.note}\n` : ''}`);
  if (help.manager === 'brew' && interactive && yes(await ask('Run this command now? [y/N]', 'n'))) {
    try { execSync(help.command, { stdio: 'inherit' }); } catch { console.log('\nThe install command failed; fix it and run `npm run setup` again.'); }
    results = checkEnvironment();
  }
}
const stillMissing = results.filter((r) => !r.ok && r.required && r.name !== 'Whisper model');
if (stillMissing.length) {
  console.log(`\n✗ Missing required tools: ${stillMissing.map((r) => r.name).join(', ')}.\n  Install them, then run \`npm run setup\` again.\n`);
  rl?.close();
  process.exit(1);
}

/* 2) Whisper model */
if (findWhisperModel() && !option('whisper')) {
  console.log(`\n✓ Whisper model: ${path.basename(findWhisperModel())}`);
} else {
  let name = option('whisper');
  if (!name) {
    console.log('\nChoose a Whisper (speech-to-text) model. English-only models:\n');
    Object.entries(WHISPER_MODELS).forEach(([n, m], i) => console.log(`  ${i + 1}) ${n.padEnd(10)} ${m.size.padEnd(8)} ${m.note}`));
    const pick = await ask('\nModel [1]:', '1');
    name = Object.keys(WHISPER_MODELS)[Number(pick) - 1] || (WHISPER_MODELS[pick] ? pick : 'medium.en');
  }
  if (!WHISPER_MODELS[name]) { console.log(`✗ Unknown Whisper model "${name}"`); process.exit(2); }
  const file = WHISPER_MODELS[name].file;
  console.log(`\n→ Downloading ${file} (${WHISPER_MODELS[name].size}) to ${MODELS_DIR}`);
  await download(whisperModelUrl(name), path.join(MODELS_DIR, file), { sha256: await huggingFaceSha256('ggerganov/whisper.cpp', file), label: file });
  console.log(`✓ Whisper model ready: ${file}`);
}

/* 3) translation model (optional) */
if (modelInstalled()) {
  console.log(`✓ Translation model: ${TRANSLATOR.file}`);
} else if (!flag('no-translator')) {
  let want = flag('translator');
  if (!want && interactive) {
    console.log(`
Optional: local translation of subtitles into your language (HY-MT1.5-1.8B, ~1.9 GB, runs offline).
  License: Tencent HY Community License — NOT valid in the European Union, the United Kingdom and South Korea.
           By downloading it you confirm you are allowed to use it where you live. Details: docs/TRANSLATION.md`);
    want = yes(await ask('Download the translation model? [y/N]', 'n'));
    if (want) want = yes(await ask('I have read the license and may use this model in my country [y/N]', 'n'));
  } else if (want && !flag('accept-hymt-license')) {
    console.log('\n✗ --translator needs --accept-hymt-license (the model license is not valid in the EU, UK and South Korea; see docs/TRANSLATION.md).');
    process.exit(2);
  }
  if (want) {
    if (!which('llama-server') && !process.env.LLAMA_SERVER_BIN) console.log('  note: llama-server is still missing; translation will not start until it is installed.');
    console.log(`\n→ Downloading ${TRANSLATOR.file} (1.9 GB) to ${TRANSLATOR.dir}`);
    const url = `https://huggingface.co/${TRANSLATOR.repo}/resolve/main/${TRANSLATOR.file}`;
    await download(url, TRANSLATOR.modelPath, { sha256: await huggingFaceSha256(TRANSLATOR.repo, TRANSLATOR.file), label: TRANSLATOR.file });
    for (const f of ['License.txt', 'README.md']) {
      await download(`https://huggingface.co/${TRANSLATOR.repo}/resolve/main/${f}`, path.join(TRANSLATOR.dir, f)).catch(() => {});
    }
    console.log('✓ Translation model ready.');
  } else {
    console.log('\n– Translation model skipped (you can add it later with: npm run setup -- --translator --accept-hymt-license)');
  }
}

if (flag('shortcut') || (interactive && !flag('no-shortcut'))) {
  if (flag('shortcut') || yes(await ask('\nPut a "YT Altyazı" shortcut on your Desktop (starts the app and opens the browser)? [Y/n]', 'y'))) {
    try {
      const { createShortcut } = await import('./shortcut.mjs');
      for (const f of createShortcut()) console.log(`✓ Shortcut: ${f}`);
    } catch (e) {
      console.log(`– Could not create the shortcut (${e.message}). You can try again with: npm run shortcut`);
    }
  }
}

rl?.close();
console.log('\nAll set. Start the app with:  npm start   (or use the Desktop shortcut; add one later with: npm run shortcut)\n');
