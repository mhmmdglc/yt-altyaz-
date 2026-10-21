// Remembers AI answers (data/ai-cache.json) so the same request never goes out twice.
import crypto from 'node:crypto';
import path from 'node:path';
import { jsonStore } from './store.js';

const MAX_ENTRIES = 3000;

export function createAICache(dataDir) {
  const store = jsonStore(path.join(dataDir, 'ai-cache.json'), { entries: {} });
  const keyOf = (parts) => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
  return {
    keyOf,
    async get(key) { return (await store.read()).entries[key]?.value ?? null; },
    set(key, value) {
      return store.update((data) => {
        data.entries[key] = { value, at: Date.now() };
        const keys = Object.keys(data.entries);
        if (keys.length > MAX_ENTRIES) {
          keys.sort((a, b) => data.entries[a].at - data.entries[b].at).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete data.entries[k]);
        }
        return data;
      });
    }
  };
}
