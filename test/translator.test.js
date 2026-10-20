import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// A fake llama-server: echoes the prompt it receives so we can assert on it
const prompts = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const prompt = JSON.parse(body || '{}').messages?.[0]?.content ?? '';
    prompts.push(prompt);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: `«${prompt.split('\n').pop()}»` } }] }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.HYMT_URL = `http://127.0.0.1:${fake.address().port}`;
const { translate, translateLine, translateWord, splitSentences } = await import('../translator.js');
test.after(() => fake.close());

test('prompt uses the official template with the English language name', async () => {
  prompts.length = 0;
  await translate('Hello there.', 'tr');
  assert.equal(prompts[0], 'Translate the following segment into Turkish, without additional explanation.\n\nHello there.');
});

test('Chinese targets use the Chinese template (ZH<=>XX)', async () => {
  prompts.length = 0;
  await translate('Hello.', 'zh');
  await translate('Hello.', 'zh-Hant');
  assert.match(prompts[0], /^将以下文本翻译为中文/);
  assert.match(prompts[1], /^将以下文本翻译为繁体中文/);
});

test('unsupported target languages are rejected', async () => {
  await assert.rejects(() => translate('Hi', 'xx'), /Unsupported target language/);
});

test('multi-sentence cards are translated sentence by sentence', async () => {
  prompts.length = 0;
  const r = await translateLine('First one. Second one? Third!', 'de');
  assert.equal(prompts.length, 3);
  assert.equal(r.parts.length, 3);
  assert.equal(r.tr, r.parts.join(' '));
});

test('single-sentence cards produce no parts', async () => {
  const r = await translateLine('Just one sentence.', 'de');
  assert.equal(r.parts, undefined);
});

test('explicit sentences from the card are used instead of re-splitting', async () => {
  prompts.length = 0;
  await translateLine('Dr. Smith left. Bye.', 'fr', ['Dr. Smith left.', 'Bye.']);
  assert.equal(prompts.length, 2);
});

test('word meanings expand contractions first and are cached per language', async () => {
  prompts.length = 0;
  const a = await translateWord("don't", 'es');
  assert.equal(a.expanded, 'do not');
  assert.match(prompts[0], /do not$/);
  const before = prompts.length;
  await translateWord("don't", 'es');
  assert.equal(prompts.length, before, 'second lookup is served from the cache');
  await translateWord("don't", 'it');
  assert.equal(prompts.length, before + 1, 'a different language is a different cache entry');
});

test('splitSentences handles the three sentence-ending marks and ellipsis', () => {
  assert.deepEqual(splitSentences('A b. C d? E f! G…'), ['A b.', 'C d?', 'E f!', 'G…']);
});
