import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../exec.js';

test('run reports output line by line while the command works (also lines ended by \\r)', async () => {
  const lines = [];
  const { out } = await run(process.execPath, ['-e', "process.stdout.write('a\\nb\\r'); process.stderr.write('c\\nd')"], { onLine: (l, k) => lines.push(`${k}:${l}`) });
  assert.equal(out, 'a\nb\r');
  assert.deepEqual(lines.sort(), ['err:c', 'out:a', 'out:b']); // 'd' has no line end yet
});

test('run works without a callback', async () => {
  const { out } = await run(process.execPath, ['-e', "console.log('x')"]);
  assert.equal(out.trim(), 'x');
});
