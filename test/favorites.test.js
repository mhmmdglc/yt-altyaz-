import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schedule, isDue, createFavorites } from '../favorites.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

test('a new item is due immediately', () => {
  assert.ok(isDue({ review: { due: NOW } }, NOW));
  assert.ok(!isDue({ review: { due: NOW + DAY } }, NOW));
});

test('good answers grow the interval: 1 day, 3 days, then × ease', () => {
  let r = schedule({}, 'good', NOW);
  assert.equal(r.interval, 1);
  assert.equal(r.due, NOW + DAY);
  r = schedule(r, 'good', NOW);
  assert.equal(r.interval, 3);
  r = schedule(r, 'good', NOW);
  assert.equal(r.interval, Math.round(3 * 2.5));
});

test('"again" resets the item, comes back in 10 minutes and lowers the ease', () => {
  const learned = schedule(schedule({}, 'good', NOW), 'good', NOW);
  const r = schedule(learned, 'again', NOW);
  assert.equal(r.reps, 0);
  assert.equal(r.lapses, 1);
  assert.equal(r.due, NOW + 10 * 60 * 1000);
  assert.ok(r.ease < learned.ease);
});

test('"easy" jumps further than "good", "hard" less far, and the ease never drops below 1.3', () => {
  const base = schedule(schedule({}, 'good', NOW), 'good', NOW);
  assert.ok(schedule(base, 'easy', NOW).interval > schedule(base, 'good', NOW).interval);
  assert.ok(schedule(base, 'hard', NOW).interval < schedule(base, 'good', NOW).interval);
  let r = base;
  for (let i = 0; i < 20; i++) r = schedule(r, 'hard', NOW);
  assert.ok(r.ease >= 1.3);
  assert.throws(() => schedule(base, 'perfect', NOW));
});

test('favorites: add, de-duplicate, review and remove', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fav-'));
  try {
    const fav = createFavorites(dir);
    const a = await fav.add({ kind: 'video', projectId: 'p1', cardIndex: 2, sentIndex: 1, text: 'Hello.' });
    const again = await fav.add({ kind: 'video', projectId: 'p1', cardIndex: 2, sentIndex: 1, text: 'Hello.' });
    assert.equal(again.id, a.id, 'the same sentence is not stored twice');
    const b = await fav.add({ kind: 'example', text: 'She is good at chess.', tr: 'Satrançta iyi.' });
    assert.equal((await fav.list()).length, 2);
    const reviewed = await fav.review(b.id, 'good');
    assert.equal(reviewed.review.interval, 1);
    await fav.remove(a.id);
    assert.deepEqual((await fav.list()).map((x) => x.id), [b.id]);
    // persisted to disk: a fresh instance sees the same data
    assert.equal((await createFavorites(dir).list()).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent adds are all kept', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fav-'));
  try {
    const fav = createFavorites(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => fav.add({ kind: 'example', text: `Sentence ${i}.`, tr: `${i}` })));
    assert.equal((await createFavorites(dir).list()).length, 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
