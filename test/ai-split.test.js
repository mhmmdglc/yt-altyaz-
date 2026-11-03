import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCards, cardsFromSentences } from '../segmenter.js';
import { AIError } from '../gemini.js';
import {
  annotationMask, cardWordRanges, planBatches, pauseBreaks, speechOf, batchText, exactAlign, lcsAlign, splitAtBreaks,
  splitBatch, splitTranscript, piecesToCards, coverage, splitPrompt
} from '../ai-split.js';

// Words from "text", 0.4 s each; gaps: { wordIndex: seconds of silence after it } (also returned as silences)
function makeWords(text, gaps = {}) {
  let t = 0;
  const silences = [];
  const words = text.split(/\s+/).map((w, i) => {
    const word = { w, s: +t.toFixed(2), e: +(t + 0.35).toFixed(2) };
    t += 0.4;
    if (gaps[i]) { silences.push({ a: +(word.e + 0.02).toFixed(2), b: +(word.e + 0.02 + gaps[i]).toFixed(2) }); t += gaps[i]; }
    return word;
  });
  return { words, silences };
}

const TALK = 'At this point Musa (speaking in foreign language) He actually, this is what the first command was. ' +
  'He said, "Yeah Allah, before I do it, I need some help." [Music] And so now we are learning something new. (Applause) ' +
  'The Prophet (SAW) said it too.';

// A fake AI: cuts the transcript at ‖ and then every `size` words; "tr" is a marker, so tests can see where it went
function fakeAI({ size = 4, edit = (en) => en, calls = [] } = {}) {
  return async ({ prompt, temperature }) => {
    calls.push({ prompt, temperature });
    const text = /TRANSCRIPT TO SPLIT:\n(.*)/.exec(prompt)[1];
    const pieces = [];
    for (const run of text.split(' ‖ ')) {
      const ws = run.split(' ');
      for (let i = 0; i < ws.length; i += size) pieces.push({ en: edit(ws.slice(i, i + size).join(' ')), tr: `TR(${ws.slice(i, i + size).join(' ')})` });
    }
    return { pieces };
  };
}

test('non-speech annotations are found; bracketed speech is kept', () => {
  const { words } = makeWords(TALK);
  const mask = annotationMask(words);
  const dropped = words.filter((_, i) => mask[i]).map((x) => x.w).join(' ');
  assert.equal(dropped, '(speaking in foreign language) [Music] (Applause)');
  assert.ok(!mask[words.findIndex((x) => x.w === '(SAW)')], '(SAW) is spoken');
  const music = annotationMask([{ w: '♪' }, { w: 'la' }, { w: '(upbeat' }, { w: 'music)' }, { w: '(in' }, { w: 'Arabic).' }]);
  assert.deepEqual(music, [true, false, true, true, true, true]);
});

test('original cards map to word ranges; batches end at card boundaries', () => {
  const { words, silences } = makeWords(Array.from({ length: 60 }, (_, i) => `word${i}${i % 6 === 5 ? '.' : ''}`).join(' '), { 11: 0.8, 29: 0.8, 47: 0.8 });
  const cards = buildCards(words, silences);
  const ranges = cardWordRanges(cards, words);
  assert.equal(ranges.length, cards.length);
  assert.equal(ranges[0][0], 0);
  assert.equal(ranges.at(-1)[1], words.length);
  ranges.slice(1).forEach((r, k) => assert.equal(r[0], ranges[k][1], 'ranges touch'));
  // a transcript whose cards no longer match the words is mapped by time
  const shifted = cards.map((c) => ({ ...c, text: c.text.toUpperCase() }));
  const byTime = cardWordRanges(shifted, words);
  assert.equal(byTime.at(-1)[1], words.length);
  const batches = planBatches(ranges, { target: 20, max: 30 });
  assert.ok(batches.length >= 2);
  for (const b of batches) assert.ok(ranges.some((r) => r[1] === b.to), 'a batch ends where a card ends');
  assert.equal(batches.at(-1).to, words.length);
});

test('long pauses are hard boundaries only after punctuation (or when very long)', () => {
  const { words, silences } = makeWords('We went home. Then in the masjid we prayed and then we left', { 2: 2, 5: 2, 8: 3.5 });
  const breaks = pauseBreaks(words, silences, 1.5, 3);
  assert.deepEqual([...breaks].map((i) => words[i].w), ['home.', 'prayed']); // "the … masjid" is a hesitation, "prayed" a very long pause
  const mask = annotationMask(words);
  const speech = speechOf(words, breaks, mask, 0, words.length);
  assert.equal(batchText(words, speech), 'We went home. ‖ Then in the masjid we prayed ‖ and then we left');
});

test('exact check: same words (case and quote style aside), and it says where a mismatch is', () => {
  const batch = ['He', 'said,', '"Yeah', "don't", 'go."'];
  const ok = exactAlign([{ en: 'He said,', tr: 'a' }, { en: '“yeah don’t go.”', tr: 'b' }], batch);
  assert.deepEqual(ok.runs, [{ from: 0, to: 2, tr: 'a' }, { from: 2, to: 5, tr: 'b' }]);
  assert.ok(exactAlign([{ en: 'He said, Yeah', tr: 'a' }, { en: 'don\'t go.', tr: 'b' }], batch).runs, 'quotes around a word do not count');
  assert.match(exactAlign([{ en: 'He told,', tr: 'a' }, { en: '"Yeah don\'t go."', tr: 'b' }], batch).error, /"told," where the transcript has "said,"/);
  assert.match(exactAlign([{ en: 'He said,', tr: 'a' }], batch).error, /stop before the end/);
  assert.match(exactAlign([{ en: 'He said, "Yeah don\'t go." Bye', tr: 'a' }], batch).error, /extra text/);
  assert.equal(exactAlign([{ en: 'He said, ‖ "Yeah', tr: 'a' }, { en: 'don\'t go."', tr: 'b' }], batch).crossings, 1);
});

test('fallback alignment accepts small differences (punctuation, a dropped annotation word) and refuses rewrites', () => {
  const batch = 'so we went to the market and we bought some bread and then we came back home very tired that evening'.split(' ').concat(
    'and nobody said anything at all about it for a very long time because everyone was simply too tired to talk about it now'.split(' '),
    'and that was the end of the long story that I wanted to tell you all tonight my friends thank you very much indeed for listening'.split(' '));
  const pieces = [
    { en: 'So we went to the market, and we bought some bread,', tr: 'A' },
    { en: 'and then we came back home very tired that evening.', tr: 'B' },
    { en: batch.slice(20, 44).join(' '), tr: 'C' },
    { en: batch.slice(44).join(' ').replace('tonight ', 'tonight (Applause) '), tr: 'D' }
  ];
  const r = lcsAlign(pieces, batch);
  assert.ok(r, 'aligned');
  assert.equal(r.runs.map((x) => x.to - x.from).reduce((a, b) => a + b), batch.length, 'every word is placed');
  assert.deepEqual(r.runs.map((x) => x.tr), ['A', 'B', 'C', 'D']);
  r.runs.slice(1).forEach((x, k) => assert.equal(x.from, r.runs[k].to, 'contiguous and in order'));
  // one missing word out of 70 is under 98 %? no: 69/70 = 98.6 % → accepted; a rewrite is not
  const missing = lcsAlign([{ en: batch.slice(1).join(' '), tr: 'X' }], batch);
  assert.ok(missing);
  assert.equal(missing.runs[0].from, 0, 'an unmatched first word joins the first piece');
  assert.equal(lcsAlign([{ en: 'We visited the shop and purchased a loaf before returning.', tr: 'X' }], batch), null);
});

test('a piece running over ‖ is cut there; the translation stays with the larger part', () => {
  const breakAfter = [false, true, false, false, false, false];
  const out = splitAtBreaks([{ from: 0, to: 2, tr: 'A' }, { from: 2, to: 6, tr: 'B' }], breakAfter);
  assert.deepEqual(out, [{ from: 0, to: 2, tr: 'A' }, { from: 2, to: 6, tr: 'B' }]);
  // "w0 w1 ‖ w2" + "w3 w4 w5": w2 is a leftover after the break and joins the next piece
  const cut = splitAtBreaks([{ from: 0, to: 3, tr: 'A' }, { from: 3, to: 6, tr: 'B' }], breakAfter);
  assert.deepEqual(cut, [{ from: 0, to: 2, tr: 'A' }, { from: 2, to: 6, tr: 'B' }]);
});

test('a batch: wrong answer → stricter retry → exact; still wrong → aligned or original; fatal errors stop', async () => {
  const { words, silences } = makeWords('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.');
  const speech = speechOf(words, pauseBreaks(words, silences), annotationMask(words), 0, words.length);
  let n = 0;
  const calls = [];
  const good = fakeAI({ calls });
  const flaky = async (args) => (++n === 1 ? { pieces: [{ en: 'one two three', tr: 'x' }] } : good(args));
  const r = await splitBatch({ generate: flaky, words, speech, lang: 'tr', level: 'B1' });
  assert.equal(r.mode, 'exact');
  assert.equal(r.attempts, 2);
  assert.match(calls[0].prompt, /IMPORTANT: Your previous answer did not reproduce the transcript exactly \(the pieces stop before the end/);
  assert.equal(calls[0].temperature, 0.2);

  const typo = await splitBatch({ generate: fakeAI({ edit: (en) => en.replace('fifteen.', 'fifteen!') }), words, speech, lang: 'tr' });
  assert.equal(typo.mode, 'aligned', 'a changed punctuation mark fails the exact check twice, then the words line up');
  assert.equal(typo.runs.at(-1).to, 15);
  const sloppy = await splitBatch({ generate: fakeAI({ size: 5, edit: (en) => en.replace('seven', 'sevn') }), words, speech, lang: 'tr' });
  assert.equal(sloppy.mode, 'original', '1 of 15 words differs: under 98 %');
  const junk = await splitBatch({ generate: async () => ({ pieces: [{ en: 'Something else entirely.', tr: 'x' }] }), words, speech, lang: 'tr' });
  assert.equal(junk.mode, 'original');
  await assert.rejects(splitBatch({ generate: async () => { throw new AIError('AI_QUOTA', 'quota', 429); }, words, speech, lang: 'tr' }), (e) => e.code === 'AI_QUOTA');
  const broken = await splitBatch({ generate: async () => { throw new AIError('AI_FAILED', 'bad json'); }, words, speech, lang: 'tr' });
  assert.equal(broken.mode, 'original');
});

test('the whole transcript: annotations dropped, every word kept once and in order, no overlaps, times from the words', async () => {
  const { words, silences } = makeWords(`${TALK} ${TALK}`, { 4: 2.5, 25: 1.8 });
  const cards = buildCards(words, silences);
  const calls = [];
  const progress = [];
  const { cards: ai, stats } = await splitTranscript({
    words, silences, cards, generate: fakeAI({ calls }), lang: 'tr', level: 'B1', opts: { target: 30, max: 45 },
    onProgress: (d, t) => progress.push(`${d}/${t}`)
  });
  assert.ok(calls.length >= 2, 'several batches');
  assert.equal(progress.at(-1), `${stats.batches}/${stats.batches}`);
  assert.match(calls[1].prompt, /CONTEXT BEFORE \(only for understanding/);
  assert.ok(!calls.some((c) => /speaking in foreign|\[Music\]|\(Applause\)/.test(c.prompt.split('TRANSCRIPT TO SPLIT:')[1])), 'annotations are not sent as text to split');
  const cov = coverage(ai, words);
  assert.ok(cov.same, 'every speech word exactly once, in order');
  assert.equal(cov.overlaps, 0);
  assert.ok(ai.every((c) => !/speaking|\[Music\]|\(Applause\)/.test(c.text)));
  assert.ok(ai.some((c) => c.text.includes('(SAW)')));
  for (const c of ai) {
    assert.ok(c.end > c.start);
    assert.deepEqual(c.sents, [c.text]);
    assert.deepEqual(c.sentTimes, [[c.start, c.end]]);
    assert.equal(c.trParts[0], c.tr);
    assert.ok(c.tr.startsWith('TR('));
    const ws = words.filter((w) => c.text.split(' ').includes(w.w));
    assert.ok(c.start >= Math.min(...ws.map((w) => w.s)) - 0.5 && c.start <= Math.max(...ws.map((w) => w.e)), 'starts at its words');
  }
  // "Musa" ends a piece: the annotation after it is a gap, not part of the next card
  const musa = ai.find((c) => c.text.endsWith('Musa'));
  const next = ai[ai.indexOf(musa) + 1];
  const ann = words.find((w) => w.w === '(speaking');
  assert.ok(musa.end <= ann.s + 0.3 && next.start >= ann.s, 'the annotation time stays a gap');
});

test('a batch the AI cannot split keeps its original cards (with their translation when the language matches)', async () => {
  const { words, silences } = makeWords('Hello there my friend. How are you today? I am fine thank you.');
  const cards = buildCards(words, silences).map((c, k) => ({ ...c, tr: `orig${k}` }));
  const junk = async () => ({ pieces: [{ en: 'nothing like it', tr: 'x' }] });
  await assert.rejects(splitTranscript({ words, silences, cards, generate: junk, lang: 'tr' }), (e) => e.code === 'AI_FAILED');
  const many = makeWords(Array.from({ length: 40 }, (_, i) => `w${i}${i % 5 === 4 ? '.' : ''}`).join(' '), { 9: 2.2, 19: 2.2, 29: 2.2 });
  const mc = buildCards(many.words, many.silences).map((c, k) => ({ ...c, tr: `orig${k}` }));
  let n = 0;
  const half = async (args) => (++n <= 2 ? junk(args) : fakeAI()(args)); // the first batch fails twice
  const r = await splitTranscript({ words: many.words, silences: many.silences, cards: mc, generate: half, lang: 'tr', opts: { target: 10, max: 15, concurrency: 1 } });
  assert.equal(r.stats.original, 1);
  assert.ok(r.cards[0].tr.startsWith('orig'), 'original card and translation');
  assert.ok(coverage(r.cards, many.words).same);
  const noTr = await splitTranscript({ words: many.words, silences: many.silences, cards: mc, generate: (n = 0, half), lang: 'tr', originalTr: false, opts: { target: 10, max: 15, concurrency: 1 } });
  assert.equal(noTr.cards[0].tr, '', 'another language: no stale translation');
});

test('pieces → cards: one card per piece, increasing and non-overlapping even with odd word times', () => {
  const words = [
    { w: 'A', s: 0, e: 0.4 }, { w: 'b.', s: 0.4, e: 3.0 }, { w: 'C', s: 1.0, e: 1.2 }, { w: 'd', s: 1.2, e: 1.3 }, { w: 'e.', s: 1.3, e: 1.9 }
  ];
  const cards = piecesToCards([{ idx: [0, 1], tr: 'x' }, { idx: [2], tr: 'y' }, { idx: [3, 4], tr: 'z' }], words, [{ a: 0.8, b: 0.95 }]);
  assert.equal(cards.length, 3);
  for (let k = 0; k < cards.length; k++) {
    assert.ok(cards[k].end > cards[k].start);
    if (k) assert.ok(cards[k].start >= cards[k - 1].end, 'no overlap');
  }
  assert.deepEqual(cards.map((c) => c.text), ['A b.', 'C', 'd e.']);
});

test('cardsFromSentences with pack: false gives one card per sentence; buildCards still packs', () => {
  const { words, silences } = makeWords('Hi. Yes. Ok then.');
  const sents = [{ words: words.slice(0, 1), text: 'Hi.' }, { words: words.slice(1, 2), text: 'Yes.' }, { words: words.slice(2), text: 'Ok then.' }];
  assert.equal(cardsFromSentences(sents, silences, { pack: false }).length, 3);
  assert.equal(buildCards(words, silences).length, 1);
});

test('the prompt asks for the level\'s piece length, the target language, and context marked as context only', () => {
  const p = splitPrompt({ text: 'Hello there.', before: 'Before.', after: 'After.', lang: 'tr', level: 'A2' });
  assert.match(p, /level A2/);
  assert.match(p, /about 3 to 8 words/);
  assert.match(p, /written in Turkish/);
  assert.match(p, /CONTEXT BEFORE \(only for understanding, do not split or translate it\):\nBefore\./);
  assert.match(p, /TRANSCRIPT TO SPLIT:\nHello there\./);
});
