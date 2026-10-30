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

test('drill: prompt asks for a speaking ladder in the learner language; repeated steps are dropped', async () => {
  seen.length = 0;
  reply = () => answer({
    pattern: 'be going to + place',
    explanation: 'Açıklama.',
    steps: [
      { label: 'Temel', native: 'Gidiyorum.', en: "I'm [[going]].", alternatives: ['I am going.'], hint: 'going' },
      { label: 'Kişi', native: 'Sen gidiyorsun.', en: "[[You're]] going.", alternatives: [], hint: "you're" },
      { label: 'Tekrar', native: 'Gidiyorum.', en: 'I am going.', alternatives: [], hint: '' },
      { label: 'Olumsuz', native: 'Gitmiyorum.', en: "I'm [[not]] going.", alternatives: ['I am not going.'], hint: 'not' }
    ]
  });
  const { drill, drillPrompt } = await import('../gemini.js');
  const r = await drill({ apiKey: 'k', sentence: "I'm going to Istanbul.", lang: 'tr', level: 'A2' });
  const prompt = seen[0].body.contents[0].parts[0].text;
  assert.match(prompt, /SPEAKING drill for a Turkish-speaking learner of English at CEFR level A2/);
  assert.match(prompt, /ladder of 8 steps/);
  assert.deepEqual(r.notes, [], 'a missing notes field gives an empty list');
  assert.equal(r.steps.length, 3, 'the repeated core sentence is removed');
  assert.deepEqual(r.steps.map((s) => s.label), ['Temel', 'Kişi', 'Olumsuz']);
  assert.match(drillPrompt({ sentence: 'x', lang: 'tr', level: 'C1' }), /ladder of 15 steps/);
});

test('drill: the number of steps follows the sentence length and the level', async () => {
  const { drillStepCount, DRILL_MIN, DRILL_MAX } = await import('../gemini.js');
  const of = (words, level) => drillStepCount(Array(words).fill('word').join(' '), level);
  // short sentences keep the per-level counts
  assert.deepEqual(['A2', 'B1', 'B2', 'C1'].map((l) => of(4, l)), [8, 12, 14, 15]);
  assert.equal(of(8, 'B1'), 12);
  // longer ones are built up piece by piece: about half a step per word, more for lower levels
  assert.equal(of(12, 'B1'), 7);
  assert.equal(of(26, 'B1'), 14);
  assert.equal(of(26, 'A2'), 16);
  assert.equal(of(26, 'C1'), 12);
  assert.equal(of(40, 'B1'), 20);
  // never above 20 or below 6, monotone in the length from 9 words on, unknown level = B1
  for (const l of ['A2', 'B1', 'B2', 'C1']) {
    let prev = 0;
    for (let w = 9; w <= 120; w++) {
      const n = of(w, l);
      assert.ok(n >= DRILL_MIN && n <= DRILL_MAX && n >= prev, `${l} ${w}`);
      prev = n;
    }
  }
  assert.equal(of(26, 'Z9'), of(26, 'B1'));
  assert.equal(of(0, 'B1'), 12);
});

test('drill: the prompt asks for the exact count, gradual build-up and grammar notes', async () => {
  const { drillPrompt } = await import('../gemini.js');
  const long = drillPrompt({ sentence: Array(26).fill('word').join(' '), lang: 'tr', level: 'B1' });
  assert.match(long, /exactly 14 steps/);
  assert.match(long, /"chunks"/);
  assert.match(long, /GRADUAL/);
  assert.match(long, /"notes": 0 to 3 things/);
  assert.match(long, /return \[\]/);
  const short = drillPrompt({ sentence: 'I have a limit.', lang: 'tr', level: 'B1' });
  assert.match(short, /ladder of 12 steps/);
  assert.doesNotMatch(short, /exactly \d+ steps/);
});

test('drill: grammar notes are trimmed, incomplete ones dropped, at most 3', async () => {
  const { cleanNotes } = await import('../gemini.js');
  const n = (i) => ({ title: ` Title ${i} `, explanation: `Explanation ${i}`, example: { en: `A [[b]] ${i}`, tr: `Bir [[b]] ${i}` } });
  assert.deepEqual(cleanNotes(undefined), []);
  assert.deepEqual(cleanNotes('x'), []);
  assert.deepEqual(cleanNotes([]), []);
  assert.deepEqual(cleanNotes([{ title: '', explanation: 'e' }, { title: 't' }, null, 5]), []);
  const out = cleanNotes([n(1), n(2), n(3), n(4)]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { title: 'Title 1', explanation: 'Explanation 1', example: { en: 'A [[b]] 1', tr: 'Bir b 1' } });
  // a note without a usable example is kept without it
  assert.equal(cleanNotes([{ title: 't', explanation: 'e', example: { en: 'only english' } }])[0].example, null);
});

test('drill: notes come through, steps ending on a function word and "…" translations are dropped, long ladders are capped', async () => {
  const { drill, capSteps, dropDanglingSteps } = await import('../gemini.js');
  const step = (en, native = 'çeviri') => ({ label: 'l', en, native, alternatives: [], hint: '' });
  reply = () => answer({
    pattern: 'p', explanation: 'e',
    notes: [{ title: 'be familiar with X as Y', explanation: 'Açıklama.', example: { en: 'I know him [[as]] a teacher.', tr: 'Onu öğretmen olarak tanırım.' } }],
    steps: [
      step('You may be familiar'), step('You may be familiar with'), step('You may be familiar with shukr'), step('You may be familiar with shukr as'),
      step('You may be familiar with shukr as something'), step('You may be familiar with shukr as something we', 'x ... y'),
      step('You may be familiar with shukr as something we have to'), step('You may be familiar with shukr as something we have to do.')
    ]
  });
  const r = await drill({ apiKey: 'k', sentence: 'You may be familiar with shukr as something we have to do.', lang: 'tr' });
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].example.en, 'I know him [[as]] a teacher.');
  // "with" goes ("…" step too), but the ladder never shrinks below 6 steps: "as" and "to" stay
  assert.deepEqual(r.steps.map((s) => s.en), [
    'You may be familiar', 'You may be familiar with shukr', 'You may be familiar with shukr as', 'You may be familiar with shukr as something',
    'You may be familiar with shukr as something we have to', 'You may be familiar with shukr as something we have to do.'
  ]);
  // never drops a step if the neighbours would be more than 4 words apart, nor the first or the last one
  const gap = [step('I go'), step('I go to'), step('I go to the big old market place by the river.')];
  assert.equal(dropDanglingSteps(gap).length, 3);
  const many = Array.from({ length: 26 }, (_, i) => step(`word ${i}`));
  const capped = capSteps(many);
  assert.equal(capped.length, 20);
  assert.equal(capped[0].en, 'word 0');
  assert.deepEqual(capped.slice(-2).map((s) => s.en), ['word 24', 'word 25']);
});

test('drill: the final step is the English part word for word; the step count follows the English part', async () => {
  const { drill, drillStepCount, englishPart, pickEnglish, enforceFinal, dedupeSteps, dropDanglingSteps } = await import('../gemini.js');
  const source = '"An ishqur li wali wali daik" Be grateful to me and be grateful to both of your parents.';
  const english = 'Be grateful to me and be grateful to both of your parents.';
  const step = (en, native = 'çeviri') => ({ label: 'l', en, native, alternatives: [], hint: '' });

  // N counts the English part (12 words → 7 at B1), not the Arabic
  assert.equal(englishPart(source), english);
  assert.equal(drillStepCount(source, 'B1'), 7);
  assert.equal(drillStepCount(english, 'B1'), 7);
  assert.equal(englishPart('He said "I am fine" and left the room.'), 'He said "I am fine" and left the room.', 'an English quotation stays');
  assert.equal(englishPart('"Bismillah ir rahman"'), '"Bismillah ir rahman"', 'nothing but a quotation: kept whole');
  assert.equal(englishPart('Say “La ilaha illa Allah” every day, my friend.'), 'Say every day, my friend.');

  // pickEnglish: the model's value when it is the source minus a quotation, else our own cut; the whole source when there is none
  assert.equal(pickEnglish(source, english), english);
  assert.equal(pickEnglish(source, ''), english);
  assert.equal(pickEnglish(source, 'Be kind to everyone you meet.'), english);
  assert.equal(pickEnglish('I have a limit.', undefined), 'I have a limit.');

  // a wrong last step is replaced by the English part, the new words are marked
  const wrong = [step('Be grateful'), step('Be grateful to me'), step('Be grateful to me and be grateful'), step('Be grateful to me and be grateful to both of [[parents.]]')];
  const fixed = enforceFinal(wrong, english);
  assert.equal(fixed.length, 4);
  assert.equal(fixed[3].en, 'Be grateful to me and be grateful [[to both of your parents.]]');
  assert.equal(fixed[3].native, 'çeviri');
  // a step that already is the English part ends the ladder (a stray extension after it goes)
  assert.deepEqual(enforceFinal([step('Be grateful'), step('Be grateful to me and [[be grateful to both of your parents.]]'), step('Be grateful to me and be grateful to both of your parents, always.')], english).map((x) => x.en).length, 2);
  // no continuation of the previous step: nothing is marked
  assert.equal(enforceFinal([step('One'), step('Two')], english)[1].en, english);

  // repeats are removed but the final step is never lost
  assert.deepEqual(dedupeSteps([step('I am going.'), step("I'm [[going]]."), step('We go.'), step('I am going')]).map((x) => x.en), ['We go.', 'I am going']);
  // the floor for dangling steps
  const six = ['Be', 'Be grateful', 'Be grateful to', 'Be grateful to me', 'Be grateful to me and', 'Be grateful to me and be'].map((x) => step(x));
  assert.equal(dropDanglingSteps(six, 6).length, 6);
  assert.ok(dropDanglingSteps(six, 0).length < 6);

  // end to end: the model's last step lacks "your", the Arabic sits in a step, the ladder is short
  reply = () => answer({
    english, pattern: 'Emir kipi (Imperative)', explanation: 'e', notes: [], chunks: [],
    steps: [
      step('Be grateful'), step('An ishqur li wali. Be grateful to me'), step('Be grateful to me'), step('Be grateful to me and be grateful'),
      step('Be grateful to me and be grateful to both of [[parents.]]')
    ]
  });
  const r = await drill({ apiKey: 'k', sentence: source, lang: 'tr' });
  assert.deepEqual(r.steps.map((x) => x.en.replace(/\[\[|\]\]/g, '')), ['Be grateful', 'Be grateful to me', 'Be grateful to me and be grateful', english]);
  // without an `english` field the fallback (our own cut of the source) is used
  reply = () => answer({ pattern: 'p', explanation: 'e', notes: [], chunks: [], steps: [step('Be grateful'), step('Be grateful to me'), step('Be grateful to me and be grateful to both of your')] });
  const r2 = await drill({ apiKey: 'k', sentence: source, lang: 'tr' });
  assert.equal(r2.steps.at(-1).en.replace(/\[\[|\]\]/g, ''), english);
});

test('drill: the DeepSeek schema example shows notes (with an example pair), chunks and steps', async () => {
  const { DRILL_SCHEMA } = await import('../gemini.js');
  const { schemaExample } = await import('../deepseek.js');
  const ex = schemaExample(DRILL_SCHEMA);
  assert.deepEqual(Object.keys(ex), ['english', 'pattern', 'explanation', 'notes', 'chunks', 'steps']);
  assert.deepEqual(ex.notes, [{ title: '…', explanation: '…', example: { en: '…', tr: '…' } }]);
  assert.deepEqual(ex.chunks, ['…']);
  assert.deepEqual(Object.keys(ex.steps[0]), ['label', 'en', 'native', 'alternatives', 'hint']);
});

test('drill: a quotation in another language is not practised; everything else follows the language setting', async () => {
  const { drill, drillPrompt, foreignTokens, dropDanglingSteps } = await import('../gemini.js');
  const source = '"An ishqur li wali wali daik" Be grateful to me and be grateful to both of your parents.';
  // the prompts name the language rule and the foreign-quotation rule (drill and vary)
  for (const p of [drillPrompt({ sentence: source, lang: 'tr', level: 'B1' }), varyPrompt({ sentence: source, lang: 'tr' })]) {
    assert.match(p, /FOREIGN QUOTATIONS/);
    assert.match(p, /written in Turkish, never in English/);
    assert.match(p, /do not write the pattern name in English/);
  }
  assert.match(drillPrompt({ sentence: source, lang: 'tr' }), /sensible Turkish translation on its own/);

  const english = 'Be grateful to me and be grateful to both of your parents.';
  assert.deepEqual([...foreignTokens(source, english)].sort(), ['an', 'daik', 'ishqur', 'li', 'wali']);
  assert.equal(foreignTokens(source, '').size, 0, 'no english field: nothing is filtered');
  assert.equal(foreignTokens(source, source).size, 0, 'nothing foreign');
  assert.equal(foreignTokens(source, 'Something completely different here.').size, 0, 'a rewritten sentence is not a cut');
  assert.equal(foreignTokens('Ab cd ef gh.', 'Ab.').size, 0, 'a cut that removes most of the source is not trusted');

  const step = (en) => ({ label: 'l', en, native: 'çeviri', alternatives: [], hint: '' });
  reply = () => answer({
    english, pattern: 'Emir kipi (Imperative)', explanation: 'e', notes: [], chunks: [],
    steps: [step('Be grateful'), step('An ishqur li wali wali daik. Be grateful to me'), step('Be grateful to me'), step('Be grateful to me and to your parents'), step(english)]
  });
  const r = await drill({ apiKey: 'k', sentence: source, lang: 'tr' });
  assert.deepEqual(r.steps.map((x) => x.en), ['Be grateful', 'Be grateful to me', 'Be grateful to me and to your parents', english]);
  assert.equal(r.pattern, 'Emir kipi (Imperative)');
  // the steps stay untouched when the model gives no (or a useless) "english"
  reply = () => answer({ pattern: 'p', explanation: 'e', notes: [], chunks: [], steps: [step('One two'), step('One two three'), step('One two three four')] });
  assert.equal((await drill({ apiKey: 'k', sentence: 'One two three four', lang: 'tr' })).steps.length, 3);

  // steps that end on "and be" / "your" and a first step like "I am" or "You may be" are dropped when the ladder stays gradual
  const d = dropDanglingSteps([step('I am'), step('I am good'), step('I am good at it'), step('I am good at it and'), step('I am good at it and happy.')]);
  assert.deepEqual(d.map((x) => x.en), ['I am good', 'I am good at it', 'I am good at it and happy.']);
  assert.deepEqual(dropDanglingSteps([step('You may be'), step('You may be familiar'), step('You may be familiar with shukr'), step('You may be familiar with shukr as something')]).map((x) => x.en), ['You may be familiar', 'You may be familiar with shukr', 'You may be familiar with shukr as something']);
});

test('drill: too few steps is an error', async () => {
  reply = () => answer({ pattern: 'p', explanation: 'e', steps: [{ label: 'a', native: 'b', en: 'c', alternatives: [], hint: '' }] });
  const { drill } = await import('../gemini.js');
  await assert.rejects(() => drill({ apiKey: 'k', sentence: 'x', lang: 'tr' }), (e) => e.code === 'AI_FAILED');
});
