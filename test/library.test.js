import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchLibrary, sentencesOfCard } from '../library.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'lib-'));
const ID = '11111111-2222-3333-4444-555555555555';
mkdirSync(path.join(dir, ID));
writeFileSync(path.join(dir, ID, 'project.json'), JSON.stringify({
  id: ID, title: 'Talk',
  segments: [
    { start: 0, end: 6, text: "I'm not good at accounting. I have a limit.", sents: ["I'm not good at accounting.", 'I have a limit.'], sentTimes: [[0, 3], [3, 6]], tr: 'Muhasebede iyi değilim. Bir sınırım var.', trParts: ['Muhasebede iyi değilim.', 'Bir sınırım var.'] },
    { start: 6, end: 9, text: 'She is very good at organizing.', sents: ['She is very good at organizing.'], tr: 'Organize etmekte çok iyi.' },
    { start: 9, end: 12, text: 'This goodness is at home.', sents: ['This goodness is at home.'] }
  ]
}));
mkdirSync(path.join(dir, 'not-a-project'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('finds sentences containing the pattern phrase, with times and translation parts', async () => {
  const hits = await searchLibrary(dir, ['good at']);
  assert.deepEqual(hits.map((h) => h.text).sort(), ["I'm not good at accounting.", 'She is very good at organizing.']);
  const first = hits.find((h) => h.text.startsWith("I'm"));
  assert.equal(first.tr, 'Muhasebede iyi değilim.');
  assert.deepEqual([first.start, first.end], [0, 3]);
  assert.equal(first.sentIndex, 0);
});

test('matches whole words only and skips the sentence being studied', async () => {
  const hits = await searchLibrary(dir, ['good at'], { exclude: "I'm not good at accounting." });
  assert.deepEqual(hits.map((h) => h.text), ['She is very good at organizing.']);
  assert.deepEqual(await searchLibrary(dir, ['goodness at']), []);
});

test('sentences matching more phrases rank first; tiny phrases are ignored', async () => {
  const hits = await searchLibrary(dir, ['good at', 'not good', 'a']);
  assert.equal(hits[0].text, "I'm not good at accounting.");
});

test('cards without per-sentence times fall back to the card times', () => {
  const s = sentencesOfCard({ start: 5, end: 9, text: 'One. Two.', sents: ['One.', 'Two.'] });
  assert.deepEqual(s.map((x) => [x.start, x.end]), [[5, 9], [5, 9]]);
});
