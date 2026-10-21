// A small JSON file store: reads are cached, writes go through one queue so concurrent updates never clobber each other.
import { readFile, writeFile, rename } from 'node:fs/promises';

export function jsonStore(file, initial) {
  let cache = null;
  let queue = Promise.resolve();

  async function read() {
    if (cache) return cache;
    try { cache = JSON.parse(await readFile(file, 'utf8')); } catch { cache = structuredClone(initial); }
    return cache;
  }

  // fn(data) mutates the data (or returns a new object); the result is written atomically
  function update(fn) {
    const next = queue.then(async () => {
      const data = await read();
      const result = (await fn(data)) ?? data;
      cache = result;
      await writeFile(`${file}.tmp`, JSON.stringify(result, null, 2));
      await rename(`${file}.tmp`, file);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }

  return { read, update };
}
