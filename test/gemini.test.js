import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// A fake Gemini endpoint: `reply` decides what it answers
const seen = [];
let reply = () => ({ status: 200, body: {} });
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    seen.push({ url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body || '{}') });
    const { status, body: out } = reply(seen.at(-1));
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.GEMINI_API_BASE = `http://127.0.0.1:${fake.address().port}`;
const { generateJSON, vary, wordInContext, varyPrompt, AIError } = await import('../gemini.js');
test.after(() => fake.close());

const answer = (obj) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });

test('sends the key in a header (never in the URL) and asks for JSON with a schema', async () => {
  seen.length = 0;
  reply = () => answer({ ok: true });
  await generateJSON({ apiKey: 'KEY123', model: 'm-1', prompt: 'hi', schema: { type: 'OBJECT' } });
  assert.equal(seen[0].key, 'KEY123');
  assert.ok(!seen[0].url.includes('KEY123'));
  assert.equal(seen[0].url, '/models/m-1:generateContent');
  assert.equal(seen[0].body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(seen[0].body.generationConfig.responseSchema, { type: 'OBJECT' });
});

test('retries without the schema when the model rejects it', async () => {
  seen.length = 0;
  reply = (r) => (r.body.generationConfig.responseSchema ? { status: 400, body: { error: { message: 'Invalid responseSchema' } } } : answer({ ok: 1 }));
  assert.deepEqual(await generateJSON({ apiKey: 'k', prompt: 'p', schema: {} }), { ok: 1 });
  assert.equal(seen.length, 2);
});

test('maps HTTP errors to clear error codes', async () => {
  const cases = [
    [{ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }, 'AI_KEY_INVALID'],
    [{ status: 403, body: { error: { message: 'denied' } } }, 'AI_KEY_INVALID'],
    [{ status: 429, body: { error: { message: 'quota' } } }, 'AI_QUOTA'],
    [{ status: 404, body: { error: { message: 'no such model' } } }, 'AI_MODEL'],
    [{ status: 500, body: { error: { message: 'boom' } } }, 'AI_FAILED'],
    [{ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }, 'AI_BLOCKED'],
    [{ status: 200, body: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] } }, 'AI_FAILED']
  ];
  for (const [r, code] of cases) {
    reply = () => r;
    await assert.rejects(() => generateJSON({ apiKey: 'k', prompt: 'p', schema: {} }), (e) => e instanceof AIError && e.code === code, code);
  }
  await assert.rejects(() => generateJSON({ apiKey: '', prompt: 'p' }), (e) => e.code === 'NO_AI_KEY');
});

test('vary: prompt names the language and level, results are cleaned', async () => {
  seen.length = 0;
  reply = () => answer({
    pattern: 'be not good at + -ing',
    explanation: 'Bir şeyde iyi olmamak.',
    examples: [{ en: "She's [[not good at]] cooking.", translation: 'Yemek [[yapmakta]] iyi değil.' }, { en: '', translation: 'x' }],
    search: ['Good At', 'not good at']
  });
  const r = await vary({ apiKey: 'k', sentence: "I'm not good at accounting.", lang: 'tr', level: 'B1' });
  const prompt = seen[0].body.contents[0].parts[0].text;
  assert.match(prompt, /Turkish-speaking learners at CEFR level B1/);
  assert.match(prompt, /I'm not good at accounting\./);
  assert.equal(r.examples.length, 1, 'empty examples are dropped');
  assert.equal(r.examples[0].tr, 'Yemek yapmakta iyi değil.', 'brackets are removed from translations');
  assert.deepEqual(r.search, ['good at', 'not good at']);
});

test('vary: asks for new examples, excluding the ones already shown', () => {
  const p = varyPrompt({ sentence: 'x', lang: 'de', exclude: ['A one.', 'B two.'] });
  assert.match(p, /German-speaking/);
  assert.match(p, /Do not repeat any of these sentences: "A one\."; "B two\."/);
});

test('word in context returns lemma, part of speech and meaning', async () => {
  reply = () => answer({ lemma: 'trunk', pos: 'isim', meaning: 'hortum', note: '' });
  const r = await wordInContext({ apiKey: 'k', word: 'trunks', sentence: 'Elephants have long trunks.', lang: 'tr' });
  assert.deepEqual(r, { word: 'trunks', lemma: 'trunk', pos: 'isim', tr: 'hortum', note: '' });
});
