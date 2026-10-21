// Optional AI features through the Google Gemini API: sentence variations ("Vary") and word meanings in context.
// Only the sentence you act on is sent. Docs: docs/AI.md
import { findLanguage } from './languages.js';
import { tokens } from './public/speech-match.js';

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

/* ---------- 🎯 Study: a speaking ladder from the simplest core of the pattern up to the full sentence ---------- */

// How many steps the ladder has at each level
export const DRILL_STEPS = { A2: 8, B1: 12, B2: 14, C1: 15 };

const DRILL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pattern: { type: 'STRING' },
    explanation: { type: 'STRING' },
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        // English first, then its translation: generating in this order keeps the two sentences equivalent
        properties: {
          label: { type: 'STRING' },
          en: { type: 'STRING' },
          native: { type: 'STRING' },
          alternatives: { type: 'ARRAY', items: { type: 'STRING' } },
          hint: { type: 'STRING' }
        },
        propertyOrdering: ['label', 'en', 'native', 'alternatives', 'hint'],
        required: ['label', 'en', 'native', 'alternatives', 'hint']
      }
    }
  },
  required: ['pattern', 'explanation', 'steps']
};

export function drillPrompt({ sentence, context = '', lang, level = 'B1' }) {
  const language = languageName(lang);
  const steps = DRILL_STEPS[level] || 12;
  return [
    `You are building a SPEAKING drill for a ${language}-speaking learner of English at CEFR level ${level}.`,
    `The learner will see each sentence in ${language} and must SAY it in English out loud.`,
    `Source sentence from a video: "${clean(sentence)}"`,
    context ? `The sentence before it, for context only: "${clean(context)}"` : '',
    '',
    `Make a ladder of ${steps} steps that teaches the main pattern of the source sentence, from its simplest core up to the full sentence and a little beyond:`,
    'core (shortest form) → change the subject (2 or 3 steps: I / you / he, she / we / they) → negative → question → add the place or object → add a detail (with someone, a time, a reason) → combine (e.g. negative + detail) → the source sentence itself or very close to it → 1 or 2 natural extensions.',
    'Rules:',
    `- Step 1 is the shortest core of the pattern: subject + verb only (for example "I'm going." / the ${language} equivalent), without the place or object.`,
    '- Every step changes only one or two things compared to the previous one. No two steps may have the same English sentence.',
    `- Write the English sentence of each step first; its ${language} sentence must then be a faithful, natural translation of exactly that English sentence (nothing added, nothing left out).`,
    '- The English must be correct, natural, everyday English. Double-check subject–verb agreement, negatives and questions.',
    `- Write ${language} with its proper alphabet and diacritics (for Turkish: ç, ğ, ı, İ, ö, ş, ü), natural word order and correct spelling.`,
    '- Keep the meaning of the source sentence (e.g. if "going to" means movement to a place, do not turn it into the "going to" future).',
    '',
    'Return JSON:',
    '- "pattern": the pattern as a short English template.',
    `- "explanation": 1 or 2 short sentences in ${language} about the pattern.`,
    `- "steps": each with "label" (1 or 2 correctly spelled words in ${language} naming what this step practises, e.g. the subject, negative, question), "en" (the most natural English, wrapping in [[double brackets]] the words that are new or changed compared to the previous step), "native" (the faithful ${language} translation of that English sentence, which the learner sees), "alternatives" (other correct English ways to say it, e.g. without contractions, no brackets; may be empty) and "hint" (1 to 3 English key words, not the whole answer).`
  ].filter((l) => l !== '').join('\n');
}

export async function drill({ apiKey, model, sentence, context, lang, level }) {
  const out = await generateJSON({ apiKey, model, prompt: drillPrompt({ sentence, context, lang, level }), schema: DRILL_SCHEMA, temperature: 0.6 });
  const steps = (Array.isArray(out.steps) ? out.steps : [])
    .map((s) => ({
      label: clean(s.label, 40),
      native: clean(s.native ?? s.tr, 300).replace(/\[\[|\]\]/g, ''),
      en: clean(s.en, 300),
      alternatives: (Array.isArray(s.alternatives) ? s.alternatives : []).map((a) => clean(a, 300).replace(/\[\[|\]\]/g, '')).filter(Boolean).slice(0, 5),
      hint: clean(s.hint, 60).replace(/\[\[|\]\]/g, '')
    }))
    .filter((s) => s.native && s.en)
    // drop repeated steps, also ones that only differ by a contraction ("I am" / "I'm")
    .filter((s, i, all) => all.findIndex((x) => tokens(x.en).join(' ') === tokens(s.en).join(' ')) === i);
  if (steps.length < 3) throw new AIError('AI_FAILED', 'Gemini returned too few steps.');
  return { pattern: clean(out.pattern, 200), explanation: clean(out.explanation, 600), steps };
}
