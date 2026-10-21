// Optional AI features through the Google Gemini API: sentence variations ("Vary") and word meanings in context.
// Only the sentence you act on is sent. Docs: docs/AI.md
import { findLanguage } from './languages.js';

const BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const LEVELS = ['A2', 'B1', 'B2', 'C1'];

export class AIError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

// Calls generateContent with a JSON response schema and returns the parsed object
export async function generateJSON({ apiKey, model = DEFAULT_MODEL, prompt, schema, temperature = 0.7 }) {
  if (!apiKey) throw new AIError('NO_AI_KEY', 'No Gemini API key is configured.', 409);
  const call = async (withSchema) => {
    let res;
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, responseMimeType: 'application/json', ...(withSchema ? { responseSchema: schema } : {}) }
        }),
        signal: AbortSignal.timeout(60_000)
      });
    } catch (e) {
      throw new AIError('AI_OFFLINE', `Could not reach Gemini: ${e.message}`, 503);
    }
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    const message = (() => { try { return JSON.parse(text).error?.message || text; } catch { return text; } })().slice(0, 300);
    if (res.status === 400 && withSchema && /schema/i.test(message)) return null; // retry without the schema
    if (res.status === 400 && /api key/i.test(message)) throw new AIError('AI_KEY_INVALID', message, 401);
    if (res.status === 401 || res.status === 403) throw new AIError('AI_KEY_INVALID', message, 401);
    if (res.status === 404) throw new AIError('AI_MODEL', `Model "${model}" was not found: ${message}`, 400);
    if (res.status === 429) throw new AIError('AI_QUOTA', message, 429);
    throw new AIError('AI_FAILED', `Gemini error ${res.status}: ${message}`);
  };

  const data = (await call(true)) ?? (await call(false));
  const candidate = data.candidates?.[0];
  if (!candidate) throw new AIError('AI_BLOCKED', `Gemini returned no answer (${data.promptFeedback?.blockReason || 'unknown reason'}).`);
  const text = (candidate.content?.parts || []).map((p) => p.text || '').join('').trim();
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new AIError('AI_FAILED', 'Gemini returned an answer that is not valid JSON.');
  }
}

const languageName = (code) => findLanguage(code)?.name || 'English';
const clean = (s, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const VARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pattern: { type: 'STRING' },
    explanation: { type: 'STRING' },
    examples: { type: 'ARRAY', items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, translation: { type: 'STRING' } }, required: ['en', 'translation'] } },
    search: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['pattern', 'explanation', 'examples', 'search']
};

export function varyPrompt({ sentence, context = '', lang, level = 'B1', count = 4, exclude = [] }) {
  const language = languageName(lang);
  return [
    `You are an English teacher for ${language}-speaking learners at CEFR level ${level}.`,
    `Sentence from a video they are studying: "${clean(sentence)}"`,
    context ? `The sentence before it, for context only: "${clean(context)}"` : '',
    '',
    'Return JSON with these fields:',
    '- "pattern": the main reusable grammar pattern or sentence structure of the sentence, as a short English template, e.g. "be not good at + noun / verb-ing".',
    `- "explanation": in ${language}, 1 to 3 short, simple sentences explaining what the pattern means and how it is built.`,
    `- "examples": ${count} NEW, natural English sentences that use exactly the same pattern with different vocabulary and everyday situations, suitable for level ${level}. In each "en", wrap the words that belong to the pattern in [[double brackets]]. "translation" is a natural ${language} translation without brackets.`,
    exclude.length ? `  Do not repeat any of these sentences: ${exclude.map((x) => `"${clean(x, 200)}"`).join('; ')}` : '',
    '- "search": 1 to 3 short literal lowercase English phrases (1 to 4 words each) that other sentences using this pattern would contain, to search a transcript library, e.g. "good at".'
  ].filter((l) => l !== '').join('\n');
}

// Pattern, explanation and example sentences with translations
export async function vary({ apiKey, model, sentence, context, lang, level, count = 4, exclude = [] }) {
  const out = await generateJSON({ apiKey, model, prompt: varyPrompt({ sentence, context, lang, level, count, exclude }), schema: VARY_SCHEMA, temperature: 0.9 });
  const examples = (Array.isArray(out.examples) ? out.examples : [])
    .map((e) => ({ en: clean(e.en, 300), tr: clean(e.translation ?? e.tr, 400).replace(/\[\[|\]\]/g, '') }))
    .filter((e) => e.en && e.tr && !exclude.includes(e.en.replace(/\[\[|\]\]/g, '')));
  if (!examples.length) throw new AIError('AI_FAILED', 'Gemini returned no usable examples.');
  return {
    pattern: clean(out.pattern, 200),
    explanation: clean(out.explanation, 800),
    examples,
    search: (Array.isArray(out.search) ? out.search : []).map((s) => clean(s, 60).toLowerCase()).filter(Boolean).slice(0, 3)
  };
}

const WORD_SCHEMA = {
  type: 'OBJECT',
  properties: { lemma: { type: 'STRING' }, pos: { type: 'STRING' }, meaning: { type: 'STRING' }, note: { type: 'STRING' } },
  required: ['lemma', 'pos', 'meaning']
};

export function wordPrompt({ word, sentence, lang, level = 'B1' }) {
  const language = languageName(lang);
  return [
    `A ${language}-speaking English learner (level ${level}) clicked the word "${clean(word, 40)}" in this sentence:`,
    `"${clean(sentence)}"`,
    'Return JSON:',
    '- "lemma": the dictionary form of the word.',
    `- "pos": its part of speech, in ${language}.`,
    `- "meaning": its meaning IN THIS SENTENCE, in ${language}, 1 to 5 words.`,
    `- "note": optionally one short ${language} sentence about how it is used here (idiom, phrasal verb, tense…), otherwise "".`
  ].join('\n');
}

export async function wordInContext({ apiKey, model, word, sentence, lang, level }) {
  const out = await generateJSON({ apiKey, model, prompt: wordPrompt({ word, sentence, lang, level }), schema: WORD_SCHEMA, temperature: 0.2 });
  return { word, lemma: clean(out.lemma, 60), pos: clean(out.pos, 40), tr: clean(out.meaning, 120), note: clean(out.note, 300) };
}
