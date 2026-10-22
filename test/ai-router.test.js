import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Two fake providers. `geminiReply(body)` / `deepseekReply(body)` decide what each answers.
const calls = { gemini: [], deepseek: [] };
let geminiReply = () => ({ status: 200, body: {} });
let deepseekReply = () => ({ status: 200, body: {} });
const fake = (name, reply) => http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    calls[name].push({ url: req.url, headers: req.headers, body });
    const { status, body: out } = reply()(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
const g = fake('gemini', () => geminiReply);
const d = fake('deepseek', () => deepseekReply);
await new Promise((r) => g.listen(0, '127.0.0.1', r));
await new Promise((r) => d.listen(0, '127.0.0.1', r));
process.env.GEMINI_API_BASE = `http://127.0.0.1:${g.address().port}`;
process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${d.address().port}`;
const { router, geminiPaused, resetCooldown } = await import('../ai.js');
const { deepseekJSON, schemaExample } = await import('../deepseek.js');
test.after(() => { g.close(); d.close(); });

const geminiOk = (obj) => () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
const deepseekOk = (obj) => () => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const quota = () => ({ status: 429, body: { error: { message: 'Resource has been exhausted' } } });
const SCHEMA = { type: 'OBJECT', properties: { tr: { type: 'STRING' }, n: { type: 'INTEGER' }, list: { type: 'ARRAY', items: { type: 'STRING' } } } };
const both = { gemini: { apiKey: 'G-KEY', model: 'gm' }, deepseek: { apiKey: 'D-KEY', model: 'deepseek-flash' } };
const reset = () => { calls.gemini.length = 0; calls.deepseek.length = 0; resetCooldown(); };

test('Gemini answers when it can; DeepSeek is not called', async () => {
  reset();
  geminiReply = geminiOk({ tr: 'gemini' });
  const r = router(both);
  assert.deepEqual(await r.generate({ prompt: 'p', schema: SCHEMA }), { tr: 'gemini' });
  assert.equal(r.used.provider, 'gemini');
  assert.equal(calls.deepseek.length, 0);
});

test('when Gemini says the quota is used up, the same request goes to DeepSeek at once, and Gemini pauses', async () => {
  reset();
  geminiReply = quota;
  deepseekReply = deepseekOk({ tr: 'deepseek' });
  const r = router(both);
  assert.deepEqual(await r.generate({ prompt: 'hello', schema: SCHEMA }), { tr: 'deepseek' });
  assert.equal(r.used.provider, 'deepseek');
  assert.equal(calls.deepseek[0].body.messages.at(-1).content, 'hello', 'the same prompt is sent');
  assert.ok(geminiPaused());

  // while paused, Gemini is not even tried
  const r2 = router(both);
  await r2.generate({ prompt: 'again', schema: SCHEMA });
  assert.equal(calls.gemini.length, 1, 'no second Gemini call during the pause');
  assert.equal(r2.used.provider, 'deepseek');
});

test('other Gemini failures also fall back, without pausing Gemini', async () => {
  reset();
  geminiReply = () => ({ status: 500, body: { error: { message: 'boom' } } });
  deepseekReply = deepseekOk({ tr: 'ok' });
  const r = router(both);
  await r.generate({ prompt: 'p', schema: SCHEMA });
  assert.equal(r.used.provider, 'deepseek');
  assert.ok(!geminiPaused());
});

test('without a DeepSeek key the Gemini error is reported (and Gemini is never skipped)', async () => {
  reset();
  geminiReply = quota;
  const r = router({ gemini: both.gemini, deepseek: { apiKey: '' } });
  await assert.rejects(() => r.generate({ prompt: 'p', schema: SCHEMA }), (e) => e.code === 'AI_QUOTA');
  geminiReply = geminiOk({ tr: 'back' });
  assert.deepEqual(await router({ gemini: both.gemini, deepseek: { apiKey: '' } }).generate({ prompt: 'p', schema: SCHEMA }), { tr: 'back' });
});

test('only a DeepSeek key: DeepSeek is used directly', async () => {
  reset();
  deepseekReply = deepseekOk({ tr: 'only' });
  const r = router({ gemini: { apiKey: '' }, deepseek: both.deepseek });
  assert.deepEqual(await r.generate({ prompt: 'p', schema: SCHEMA }), { tr: 'only' });
  assert.equal(calls.gemini.length, 0);
});

test('no key at all, or both providers failing, gives a clear error', async () => {
  reset();
  await assert.rejects(() => router({ gemini: { apiKey: '' }, deepseek: { apiKey: '' } }).generate({ prompt: 'p' }), (e) => e.code === 'NO_AI_KEY');
  geminiReply = quota;
  deepseekReply = () => ({ status: 402, body: { error: { message: 'Insufficient Balance' } } });
  await assert.rejects(() => router(both).generate({ prompt: 'p', schema: SCHEMA }), (e) => e.code === 'AI_QUOTA' && /DeepSeek/.test(e.message));
});

test('DeepSeek request: Bearer key, JSON mode, and an example of the expected structure in the system prompt', async () => {
  reset();
  deepseekReply = deepseekOk({ tr: 'x' });
  await deepseekJSON({ apiKey: 'D-KEY', model: 'deepseek-flash', prompt: 'p', schema: SCHEMA });
  const c = calls.deepseek[0];
  assert.equal(c.url, '/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer D-KEY');
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
  assert.match(c.body.messages[0].content, /json/);
  assert.match(c.body.messages[0].content, /"tr":"…","n":0,"list":\["…"\]/);
});

test('DeepSeek: an empty answer is retried once; errors map to codes', async () => {
  reset();
  let n = 0;
  deepseekReply = () => (++n === 1 ? { status: 200, body: { choices: [{ message: { content: '' } }] } } : { status: 200, body: { choices: [{ message: { content: '{"tr":"second"}' } }] } });
  assert.deepEqual(await deepseekJSON({ apiKey: 'k', prompt: 'p', schema: SCHEMA }), { tr: 'second' });
  for (const [status, code] of [[401, 'AI_KEY_INVALID'], [402, 'AI_QUOTA'], [429, 'AI_QUOTA'], [500, 'AI_FAILED']]) {
    deepseekReply = () => ({ status, body: { error: { message: 'x' } } });
    await assert.rejects(() => deepseekJSON({ apiKey: 'k', prompt: 'p', schema: SCHEMA }), (e) => e.code === code, String(status));
  }
});

test('schemaExample follows the property order', () => {
  assert.deepEqual(Object.keys(schemaExample({ type: 'OBJECT', propertyOrdering: ['b', 'a'], properties: { a: { type: 'STRING' }, b: { type: 'STRING' } } })), ['b', 'a']);
});
