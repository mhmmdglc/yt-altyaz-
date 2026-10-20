#!/usr/bin/env node
// Rebuilds the subtitle cards of existing videos (sentence-accurate cards). Details: docs/SUBTITLE-CARDS.md
//
//   npm run regroup -- <video-id|all> [--whisper] [--no-translate]
//
//   (default)      reuses data/<id>/words.json when it exists, so Whisper does not run again (seconds)
//   --whisper      transcribes the video again with word timestamps (about 1-5 min per video) → words.json
//   --no-translate do not ask the running app to translate afterwards
import { readFile, writeFile, readdir, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, WORK_DIR, PORT, isValidId } from '../config.js';
import { analyzeAudio } from '../transcribe.js';
import { buildCards, punctuationDensity, CARD } from '../segmenter.js';

const APP = process.env.APP_URL || `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: npm run regroup -- <video-id|all> [--whisper] [--no-translate]');
  process.exit(2);
}

const ids = target === 'all'
  ? (await readdir(DATA_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && isValidId(e.name) && existsSync(path.join(DATA_DIR, e.name, 'project.json')))
      .map((e) => e.name)
  : [target];
if (ids.some((id) => !isValidId(id))) { console.error('Invalid video id.'); process.exit(2); }

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

for (const id of ids) {
  const dir = path.join(DATA_DIR, id);
  const file = path.join(dir, 'project.json');
  const project = JSON.parse(await readFile(file, 'utf8'));
  console.log(`\n▶ ${project.title.slice(0, 60)} (${id.slice(0, 8)})`);

  // Keep Whisper's original segmentation once, so you can go back
  const backup = path.join(dir, 'segments.whisper.json');
  if (!existsSync(backup)) {
    await copyFile(file, backup);
    console.log('  backup: segments.whisper.json');
  }

  const wordsFile = path.join(dir, 'words.json');
  let data;
  if (!flags.has('--whisper') && existsSync(wordsFile)) {
    data = JSON.parse(await readFile(wordsFile, 'utf8'));
    console.log('  using words.json (Whisper does not run again)');
  } else {
    await mkdir(WORK_DIR, { recursive: true });
    const t0 = Date.now();
    data = await analyzeAudio(path.join(dir, 'video.mp4'), path.join(WORK_DIR, `regroup-${id}`), (s) => console.log(`  ${s}…`));
    await writeFile(wordsFile, JSON.stringify(data));
    console.log(`  transcription took ${Math.round((Date.now() - t0) / 1000)} s`);
  }

  const dens = punctuationDensity(data.words);
  if (dens < CARD.minPunctDensity) console.log(`  ⚠ very little punctuation in this recording (${(dens * 100).toFixed(1)} sentence ends per 100 words): sentences are derived from pauses`);
  const before = project.segments.length;
  project.segments = buildCards(data.words, data.silences);
  delete project.trLang; // old translations no longer match the new cards
  await writeFile(file, JSON.stringify(project, null, 2));
  const multi = project.segments.filter((c) => c.sents.length > 1).length;
  console.log(`  ${before} → ${project.segments.length} cards (${multi} with several sentences), length ${fmt(project.segments.at(-1)?.end ?? 0)}`);

  if (!flags.has('--no-translate')) {
    try {
      const r = await fetch(`${APP}/api/project/${id}/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true })
      });
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      let st;
      do {
        await new Promise((res) => setTimeout(res, 2000));
        st = await (await fetch(`${APP}/api/project/${id}/translate`)).json();
        process.stdout.write(`\r  translating: ${st.done}/${st.total}   `);
      } while (st.status === 'running');
      console.log(st.status === 'done' ? '\n  ✓ translated' : `\n  ✗ translation failed: ${st.error}`);
    } catch (e) {
      console.log(`  ⚠ could not start translation (${e.message}). Open the app and press "Translate" in the video.`);
    }
  }
}
console.log('\nDone. Refresh the page in your browser.');
