import test from 'node:test';
import assert from 'node:assert/strict';
import { tokens, compareSpeech } from '../public/speech-match.js';

test('tokens ignore case, punctuation, brackets and expand contractions', () => {
  assert.deepEqual(tokens("[[I'm]] NOT going, to Istanbul!"), ['i', 'am', 'not', 'going', 'to', 'istanbul']);
  assert.deepEqual(tokens("We aren’t ready."), ['we', 'are', 'not', 'ready']);
  assert.deepEqual(tokens("I'm gonna go"), ['i', 'am', 'going', 'to', 'go']);
});

test('a perfect answer is good even with contractions said the other way', () => {
  const r = compareSpeech('I am going to Istanbul', "I'm going to Istanbul.");
  assert.equal(r.verdict, 'good');
  assert.equal(r.score, 1);
  assert.ok(r.words.every((w) => w.ok));
});

test('one missing word (here "not", which flips the meaning) is only close, and the missed word is marked', () => {
  const r = compareSpeech('I am going to Istanbul with you', "I'm not going to Istanbul with you.");
  assert.equal(r.verdict, 'close');
  assert.deepEqual(r.words.filter((w) => !w.ok).map((w) => w.word), ['not']);
});

test('a different sentence is wrong', () => {
  assert.equal(compareSpeech('the weather is nice today', "I'm going to Istanbul.").verdict, 'wrong');
  assert.equal(compareSpeech('', "I'm going.").verdict, 'wrong');
});

test('alternatives are accepted and the best match is reported', () => {
  const r = compareSpeech('are you going there', 'Are you going?', ['Are you going there?']);
  assert.equal(r.verdict, 'good');
  assert.equal(r.target, 'Are you going there?');
});

test('extra words lower the score', () => {
  const plain = compareSpeech("I'm going", "I'm going.");
  const extra = compareSpeech("I'm going going going home now", "I'm going.");
  assert.ok(extra.score < plain.score);
  assert.ok(extra.extra > 0);
});
