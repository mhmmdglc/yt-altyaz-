import test from 'node:test';
import assert from 'node:assert/strict';
import { wordsFromWhisper, wordsToSentences, buildCards, punctuationDensity, CARD } from '../segmenter.js';

// Helper: builds words from "text" with 0.4 s per word, optional gaps (seconds) after given word indexes
function makeWords(text, { gaps = {} } = {}) {
  let t = 0;
  return text.split(/\s+/).map((w, i) => {
    const word = { w, s: +t.toFixed(2), e: +(t + 0.4).toFixed(2) };
    t += 0.4 + (gaps[i] || 0);
    return word;
  });
}

test('wordsFromWhisper merges punctuation-only and continuation pieces, skips noise tokens', () => {
  const raw = { transcription: [
    { text: '', offsets: { from: 0, to: 500 } },
    { text: ' Hello', offsets: { from: 500, to: 900 } },
    { text: ',', offsets: { from: 900, to: 950 } },
    { text: ' world', offsets: { from: 950, to: 1300 } },
    { text: "'s", offsets: { from: 1300, to: 1400 } },
    { text: ' [BLANK_AUDIO]', offsets: { from: 1400, to: 2000 } },
    { text: ' end.', offsets: { from: 2000, to: 2500 } }
  ] };
  const words = wordsFromWhisper(raw);
  assert.deepEqual(words.map((w) => w.w), ['Hello,', "world's", 'end.']);
  assert.equal(words[1].e, 1.4);
});

test('sentences end at . ? ! but not at abbreviations or initials', () => {
  const words = makeWords('Dr. Smith met J. Doe at 5 p.m. today. Was it fun? Yes!');
  const sentences = wordsToSentences(words).map((s) => s.text);
  assert.deepEqual(sentences, ['Dr. Smith met J. Doe at 5 p.m. today.', 'Was it fun?', 'Yes!']);
});

test('an ellipsis ends a sentence only before a capital letter', () => {
  const a = wordsToSentences(makeWords('Well... maybe not. Fine... Let us go.')).map((s) => s.text);
  assert.deepEqual(a, ['Well... maybe not.', 'Fine...', 'Let us go.']);
});

test('quotes after the final punctuation stay with the sentence', () => {
  const s = wordsToSentences(makeWords('She said "Are you?" Then left.')).map((x) => x.text);
  assert.deepEqual(s, ['She said "Are you?"', 'Then left.']);
});

test('buildCards never splits a sentence and never loses text', () => {
  const text = 'One short. Two short. Three short. Four short. ' +
    'This is a much longer sentence that goes well beyond the usual card size limit, with commas, and many more words than a card should hold on its own. ' +
    'Tiny. Another one here.';
  const words = makeWords(text);
  const cards = buildCards(words, []);
  const sentences = wordsToSentences(words).map((s) => s.text);
  const fromCards = cards.flatMap((c) => c.sents);
  assert.deepEqual(fromCards, sentences, 'every sentence appears exactly once, in order');
  for (const c of cards) assert.equal(c.text, c.sents.join(' '));
});

test('cards respect the size limits, but a long sentence keeps its own card', () => {
  const long = 'This is a very long sentence ' + 'with plenty of words, '.repeat(12) + 'that never ends early.';
  const cards = buildCards(makeWords(`Hi there. Yes. ${long} After that. Done.`), []);
  for (const c of cards) {
    assert.ok(c.sents.length <= CARD.maxSentences);
    if (c.sents.length > 1) assert.ok(c.text.length <= CARD.maxChars, `merged card too long: ${c.text.length}`);
  }
  const longCard = cards.find((c) => c.text.includes('never ends early'));
  assert.equal(longCard.sents.length, 1);
  assert.ok(longCard.text.length > CARD.maxChars);
});

test('cards are ordered and never overlap', () => {
  const words = makeWords('A b c d e. F g h i j. K l m n o. P q r s t. U v w x y.', { gaps: { 4: 0.05, 9: 0.5, 14: 0.02 } });
  const silences = [{ a: 1.8, b: 2.4 }, { a: 4.3, b: 4.9 }];
  const cards = buildCards(words, silences);
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i].start >= cards[i - 1].end - 1e-9, `overlap between ${i - 1} and ${i}`);
  for (const c of cards) assert.ok(c.end > c.start && c.start >= 0);
});

test('card boundaries snap to the silence between sentences, with padding', () => {
  // Whisper reports the first sentence ending at 2.0 s, but the speech really stops at 1.2 s and resumes at 2.0 s
  const words = [
    { w: 'First', s: 0, e: 0.6 }, { w: 'one.', s: 0.6, e: 2.0 },
    { w: 'Second', s: 2.0, e: 2.6 }, { w: 'one.', s: 2.6, e: 3.2 }
  ];
  const cards = buildCards(words, [{ a: 1.2, b: 2.0 }], { maxSentences: 1 });
  assert.equal(cards.length, 2);
  assert.ok(Math.abs(cards[0].end - (1.2 + CARD.endPad)) < 0.011, `first card ends at ${cards[0].end}`);
  assert.ok(Math.abs(cards[1].start - (2.0 - CARD.startPad)) < 0.011, `second card starts at ${cards[1].start}`);
});

test('pause mode: recordings without punctuation are split at pauses', () => {
  const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const gaps = { 9: 0.6, 19: 0.6, 29: 0.6, 39: 0.6, 49: 0.6 };
  const words = makeWords(text, { gaps });
  const silences = Object.keys(gaps).map((i) => ({ a: words[i].e + 0.02, b: words[i].e + 0.6 }));
  assert.ok(punctuationDensity(words) < CARD.minPunctDensity);
  const sentences = wordsToSentences(words, silences);
  assert.equal(sentences.length, 6);
});

// A normal, well-punctuated recording followed by one long run of speech
function recordingWithRun(run) {
  const normal = Array(30).fill('Fine okay.').join(' ');
  const words = makeWords(`${normal} ${run}`);
  const start = words.findIndex((w) => w.w === run.split(' ')[0]);
  // a 0.6 s pause after every 15th word of the run
  const silences = [];
  for (let i = start + 14; i < words.length - 1; i += 15) {
    words.slice(i + 1).forEach((w) => { w.s += 0.6; w.e += 0.6; });
    silences.push({ a: words[i].e + 0.02, b: words[i].e + 0.6 });
  }
  return { words, silences };
}

test('safety net: a long run of speech without any punctuation is split at pauses', () => {
  const run = Array.from({ length: 45 }, (_, i) => `plain${i}`).join(' ') + '.';
  const { words, silences } = recordingWithRun(run);
  assert.ok(punctuationDensity(words) > CARD.minPunctDensity, 'the recording as a whole is punctuated');
  const sentences = wordsToSentences(words, silences).map((s) => s.text);
  const pieces = sentences.filter((x) => x.includes('plain'));
  assert.ok(pieces.length >= 3, `expected the run to be split, got ${pieces.length} piece(s)`);
  assert.equal(pieces.join(' '), run);
});

test('a long sentence WITH commas is a real sentence and stays whole', () => {
  const run = Array.from({ length: 45 }, (_, i) => `comma${i},`).join(' ').replace(/,$/, '.');
  const { words, silences } = recordingWithRun(run);
  const pieces = wordsToSentences(words, silences).map((s) => s.text).filter((x) => x.includes('comma'));
  assert.equal(pieces.length, 1);
});

test('buildCards on empty input returns no cards', () => {
  assert.deepEqual(buildCards([], []), []);
});
