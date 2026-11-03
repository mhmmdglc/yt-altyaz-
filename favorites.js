// Saved sentences and their spaced-repetition schedule (data/favorites.json).
import crypto from 'node:crypto';
import path from 'node:path';
import { jsonStore } from './store.js';

import { schedule, isDue, GRADES } from './public/srs.js';

export { schedule, isDue, GRADES };

export function createFavorites(dataDir) {
  const store = jsonStore(path.join(dataDir, 'favorites.json'), { items: [] });

  return {
    async list() {
      return (await store.read()).items;
    },

    // Adds a sentence; the same video sentence or the same example text is never stored twice.
    // A video sentence is the same when its text and start time match: card indexes differ between the original cards and
    // the AI split (and change when cards are rebuilt), so they are kept only as a hint.
    async add(entry) {
      let result;
      await store.update((data) => {
        result = data.items.find((x) =>
          entry.kind === 'video'
            ? x.kind === 'video' && x.projectId === entry.projectId && x.text === entry.text && Math.abs((x.start ?? 0) - (entry.start ?? 0)) < 0.5
            : x.kind === entry.kind && x.text === entry.text);
        if (result) return data;
        const now = Date.now();
        result = { id: crypto.randomUUID(), createdAt: new Date(now).toISOString(), ...entry, review: { reps: 0, interval: 0, ease: 2.5, lapses: 0, due: now } };
        data.items.unshift(result);
        return data;
      });
      return result;
    },

    remove(id) {
      return store.update((data) => { data.items = data.items.filter((x) => x.id !== id); return data; });
    },

    async review(id, grade, now = Date.now()) {
      let updated = null;
      await store.update((data) => {
        const item = data.items.find((x) => x.id === id);
        if (item) { item.review = schedule(item.review, grade, now); updated = item; }
        return data;
      });
      return updated;
    }
  };
}
