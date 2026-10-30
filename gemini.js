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

// The function that turns { prompt, schema, temperature } into an object: the provider router (ai.js), or Gemini directly
const gen = ({ apiKey, model, generate }) => generate || ((args) => generateJSON({ apiKey, model, ...args }));
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
    FOREIGN_RULE,
    languageRule(language, 'The pattern name, the explanation and every translation'),
    '',
    'Return JSON with these fields:',
    `- "pattern": the main reusable grammar pattern or sentence structure of the English part of the sentence, named in ${language} with the English template in parentheses, e.g. for Turkish "Olumsuz yeterlilik: be not good at + isim / fiil-ing".`,
    `- "explanation": in ${language}, 1 to 3 short, simple sentences explaining what the pattern means and how it is built.`,
    `- "examples": ${count} NEW, natural English sentences that use exactly the same pattern with different vocabulary and everyday situations, suitable for level ${level}. In each "en", wrap the words that belong to the pattern in [[double brackets]]. "translation" is a natural ${language} translation without brackets.`,
    exclude.length ? `  Do not repeat any of these sentences: ${exclude.map((x) => `"${clean(x, 200)}"`).join('; ')}` : '',
    '- "search": 1 to 3 short literal lowercase English phrases (1 to 4 words each) that other sentences using this pattern would contain, to search a transcript library, e.g. "good at".'
  ].filter((l) => l !== '').join('\n');
}

// Pattern, explanation and example sentences with translations
export async function vary({ apiKey, model, generate, sentence, context, lang, level, count = 4, exclude = [] }) {
  const out = await gen({ apiKey, model, generate })({ prompt: varyPrompt({ sentence, context, lang, level, count, exclude }), schema: VARY_SCHEMA, temperature: 0.9 });
  const examples = (Array.isArray(out.examples) ? out.examples : [])
    .map((e) => ({ en: clean(e.en, 300), tr: clean(e.translation ?? e.tr, 400).replace(/\[\[|\]\]/g, '') }))
    .filter((e) => e.en && e.tr && !exclude.includes(e.en.replace(/\[\[|\]\]/g, '')));
  if (!examples.length) throw new AIError('AI_FAILED', 'The AI returned no usable examples.');
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

export async function wordInContext({ apiKey, model, generate, word, sentence, lang, level }) {
  const out = await gen({ apiKey, model, generate })({ prompt: wordPrompt({ word, sentence, lang, level }), schema: WORD_SCHEMA, temperature: 0.2 });
  return { word, lemma: clean(out.lemma, 60), pos: clean(out.pos, 40), tr: clean(out.meaning, 120), note: clean(out.note, 300) };
}

/* ---------- 🎯 Study: a speaking ladder from the simplest core of the pattern up to the full sentence ---------- */

// How many steps the ladder has: it depends on the level AND on the length of the sentence.
//  - up to 8 words: DRILL_BASE[level] steps (variations of the core, then the sentence, then an extension)
//  - longer: the ladder only builds the sentence up, chunk by chunk, so the steps follow the length:
//    round(words × DRILL_PACE[level]), between 6 and 20 (a lower level takes smaller steps)
//    B1: 12 words 6 · 20 w 10 · 27 w 14 · 40+ w 20.   A2: 12 w 7 · 27 w 15 · 37+ w 20.   C1: 12 w 6 · 27 w 11 · 48+ w 20
//  (about 2 words per step, so the pieces are real phrases and not single words; steps of a long source follow its clauses)
// Shared by the Vary and Study prompts: the explanation language and foreign quotations
const languageRule = (language, what) => `LANGUAGE: ${what} are written in ${language}, never in English (do not write the pattern name in English: not "Imperative with Be and Adjective" but its ${language} name, with the English term in parentheses only if it helps). Only the English example sentences are English.`;
const FOREIGN_RULE = 'FOREIGN QUOTATIONS: if the sentence contains a quotation or recitation in another language (transliterated Arabic, Latin words, a verse, a list of names, quoted text that is clearly not English), ignore that part completely and work only with the English part of the sentence.';

export const DRILL_BASE = { A2: 8, B1: 12, B2: 14, C1: 15 };
export const DRILL_PACE = { A2: 0.6, B1: 0.55, B2: 0.5, C1: 0.45 };
export const DRILL_SHORT = 8; // words
export const DRILL_MIN = 6;
export const DRILL_MAX = 20;
export const wordCount = (text) => String(text || '').split(/\s+/).filter(Boolean).length;
// English words that tell a quotation is English: a quoted span with almost none of them is taken as foreign (transliterated Arabic, Latin, names)
const STOPWORDS = new Set('the a an and or but of to in on at for with is are am was were be been i you he she it we they me my your his her our their this that these those not do does did have has had will would can could should may might as so if than then there here what who how'.split(' '));
// The sentence without quoted spans ("…" or “…”) that do not look English; the whole sentence when little is left. Used to count the steps and as a fallback.
export function englishPart(sentence) {
  const text = clean(sentence);
  const rest = text
    .replace(/"([^"]+)"|“([^”]+)”/g, (m, a, b) => {
      const w = tokens(a ?? b);
      return w.length && w.filter((x) => STOPWORDS.has(x)).length / w.length < 0.25 ? ' ' : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return wordCount(rest) >= 3 ? rest : text;
}
export function drillStepCount(sentence, level = 'B1') {
  const words = wordCount(englishPart(sentence));
  const l = DRILL_BASE[level] ? level : 'B1';
  if (words <= DRILL_SHORT) return DRILL_BASE[l];
  return Math.max(DRILL_MIN, Math.min(DRILL_MAX, Math.round(words * DRILL_PACE[l])));
}

export const DRILL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    // the English part of the source: the whole sentence, or without a quotation in another language
    english: { type: 'STRING' },
    pattern: { type: 'STRING' },
    explanation: { type: 'STRING' },
    // 0 to 3 grammar / idiom notes about the source sentence (an empty array when nothing deserves one)
    notes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          explanation: { type: 'STRING' },
          example: {
            type: 'OBJECT',
            properties: { en: { type: 'STRING' }, tr: { type: 'STRING' } },
            propertyOrdering: ['en', 'tr'],
            required: ['en', 'tr']
          }
        },
        propertyOrdering: ['title', 'explanation', 'example'],
        required: ['title', 'explanation', 'example']
      }
    },
    // planning aid, not shown: a long source cut into its consecutive pieces (empty for short sources)
    chunks: { type: 'ARRAY', items: { type: 'STRING' } },
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
  propertyOrdering: ['english', 'pattern', 'explanation', 'notes', 'chunks', 'steps'],
  required: ['english', 'pattern', 'explanation', 'notes', 'chunks', 'steps']
};

export function drillPrompt({ sentence, context = '', lang, level = 'B1' }) {
  const language = languageName(lang);
  const steps = drillStepCount(sentence, level);
  const words = wordCount(englishPart(sentence));
  return [
    `You are building a SPEAKING drill for a ${language}-speaking learner of English at CEFR level ${level}.`,
    `The learner will see each sentence in ${language} and must SAY it in English out loud.`,
    `Source sentence from a video: "${clean(sentence)}"`,
    context ? `The sentence before it, for context only: "${clean(context)}"` : '',
    `${FOREIGN_RULE} No step may contain any word of the foreign part, and the full sentence of the last step is the English part only (put that English part in "english", with exactly its words; if there is no foreign part, "english" is the whole source, and the last step of a long source repeats it word for word, nothing missing). The step count below already counts the English part only. Mention the foreign part at most in a note, only if useful.`,
    languageRule(language, 'Every field except the English sentences ("english", "en", "alternatives", "hint", the note example "en"): "pattern", "explanation", every "label" and "native", every note "title", "explanation" and "tr"'),
    '',
    words > DRILL_SHORT
      ? `Make a ladder of exactly ${steps} steps that builds this long source up to the full sentence in small increments. First fill "chunks": the source cut in order into exactly ${steps} consecutive pieces (that is ${(words / steps).toFixed(1)} words per piece on average: no piece is longer than 3 words (split longer phrases and clauses into 2 or 3 pieces), and a piece never ends on a function word (as, with, to, that, for, of, the, a, and): keep it with what follows). The first chunk is the shortest complete core that makes sense alone (a full clause or real phrase, even if it takes 4 to 6 words); later chunks end at a natural boundary, and a function word (as, with, to, that, the, and) always stays with the phrase it introduces. Step k is the first k chunks joined, so there are exactly ${steps} steps.`
      : `Make a ladder of ${steps} steps that teaches the pattern of this short source: step 1 is the core, the shortest form that makes sense alone (subject + verb, e.g. "I'm going." / the ${language} equivalent; never a bare pronoun or verb) → other subjects (2 or 3 steps) → negative → question → add the place, object or a detail → combine → the source sentence itself → 1 or 2 natural extensions. "chunks" is [].`,
    'Rules:',
    '- GRADUAL: every step adds or changes only a little compared with the previous one. Never jump from a short piece to a long sentence: if the gap would be bigger, put another step in between. The last steps get closer and closer to the full sentence.',
    '- The source sentence itself appears exactly once, with its exact words and nothing added: as the last step (short sources: followed by at most 2 extensions). No two steps may be the same or add nothing.',
    `- Every step is a meaningful phrase that has a sensible ${language} translation on its own: if a piece cannot be translated sensibly (like a trailing "and be"), choose another chunk boundary, e.g. "Be grateful to me" → "Be grateful to me and to your parents". Never nonsense, never a repeated word.`,
    `- Write the English sentence of each step first; its ${language} sentence must then be a faithful, natural translation of exactly that English sentence (nothing added, nothing left out). An unfinished piece is translated as the natural ${language} phrase for exactly the words so far, never with "…" or "..." and never a different phrase.`,
    '- The English of every step must be correct, natural English a person could say (a real clause or phrase that ends at a natural boundary, never on a preposition, article, conjunction or "to"; never a random cut). Double-check subject–verb agreement, negatives and questions.',
    `- Write ${language} with its proper alphabet and diacritics (for Turkish: ç, ğ, ı, İ, ö, ş, ü), natural word order and correct spelling.`,
    '- Keep the meaning of the source sentence (e.g. if "going to" means movement to a place, do not turn it into the "going to" future).',
    '',
    'Return JSON:',
    `- "pattern": the name of the pattern in ${language}, with the English template in parentheses if it helps, e.g. for Turkish "Emir kipi + be + sıfat (Be + adjective)".`,
    `- "explanation": 1 or 2 short sentences in ${language} about the pattern.`,
    `- "notes": 0 to 3 things in the SOURCE sentence that are above ${level} or not literal, so a ${level} learner probably does not know them: a grammar structure, idiom, phrasal verb, collocation, or a word-order / tense point (e.g. "regard X as Y", "wish + past perfect", "get used to + -ing", a reduced relative clause). Most everyday sentences need NO note: not basic grammar a ${level} learner knows (have, be good at, simple tenses), not single words or nouns, not trivia, no filler. Prefer the 1 or 2 most useful; if nothing is really worth knowing, return []. Each note: "title" (3 to 6 words, the structure itself), "explanation" (1 or 2 short sentences in ${language}: what it means and how it works), "example" with "en" (a new, short, correct English sentence that uses the same structure as the source; wrap the structure in [[double brackets]]) and "tr" (its faithful ${language} translation).`,
    `- "steps": each with "label" (1 or 2 correctly spelled words in ${language} naming what this step adds, e.g. the subject, negative, place, reason), "en" (the most natural English, wrapping in [[double brackets]] the words that are new or changed compared to the previous step), "native" (the faithful ${language} translation of that English sentence, which the learner sees), "alternatives" (other correct English ways to say it, e.g. without contractions, no brackets; may be empty) and "hint" (1 to 3 English key words, not the whole answer).`
  ].filter((l) => l !== '').join('\n');
}

const stripBrackets = (s) => String(s ?? '').replace(/\[\[|\]\]/g, '');

// 0 to 3 grammar notes; anything incomplete is dropped, a missing or malformed `notes` gives []
export function cleanNotes(notes) {
  return (Array.isArray(notes) ? notes : [])
    .map((n) => {
      const ex = n?.example && typeof n.example === 'object' ? n.example : {};
      const en = clean(ex.en, 200);
      const tr = stripBrackets(clean(ex.tr ?? ex.native, 200));
      return {
        title: stripBrackets(clean(n?.title, 80)),
        explanation: stripBrackets(clean(n?.explanation, 400)),
        example: en && tr ? { en, tr } : null
      };
    })
    .filter((n) => n.title && n.explanation)
    .slice(0, 3);
}

// Words a spoken step should not end on: "...different for" and "...and be" are neither sayable nor translatable
const DANGLING = new Set('a an the to of for with as at in on and or but that than by from into if so because not your my our their both be am is are'.split(' '));
// A first step made only of such words, pronouns and modals ("I am", "You may be") is no sentence either
const BARE = new Set([...DANGLING, ...'i you he she we they it may might can could will would shall should must do does did'.split(' ')]);
// Drops such steps when the steps around them stay close together (at most 4 new words from one kept step to the next)
export function dropDanglingSteps(steps, minKeep = 0) {
  const words = (s) => wordCount(stripBrackets(s.en));
  const text = (s) => stripBrackets(s.en).trim();
  const dangling = (s) => !/[,;:.!?]$/.test(text(s)) && DANGLING.has(text(s).toLowerCase().split(/\s+/).pop());
  const kept = [];
  steps.forEach((s, i) => {
    const next = steps[i + 1];
    if (kept.length + (steps.length - i - 1) < minKeep) { kept.push(s); return; } // never shrink the ladder below the minimum
    if (i === 0 && next && words(s) <= 3 && text(s).toLowerCase().split(/\s+/).every((w) => BARE.has(w.replace(/[^\p{L}']/gu, '')))) return;
    if (i > 0 && next && dangling(s) && words(next) - (kept.length ? words(kept[kept.length - 1]) : 0) <= 4) return;
    kept.push(s);
  });
  return kept.length >= 3 ? kept : steps;
}

// Words of the source that are not in its English part: the quotation in another language that must not be practised.
// Gives an empty set when `english` is missing or does not look like the source minus a span (a wrong answer must not delete the ladder).
export function foreignTokens(source, english) {
  const all = tokens(source);
  const en = tokens(english);
  if (!en.length || en.length >= all.length) return new Set();
  const inEnglish = new Set(en);
  const inSource = new Set(all);
  if (en.filter((w) => inSource.has(w)).length < en.length * 0.8) return new Set(); // rewritten, not cut
  const foreign = new Set(all.filter((w) => !inEnglish.has(w)));
  return foreign.size > all.length * 0.6 ? new Set() : foreign;
}

const sameEnglish = (a, b) => tokens(a).join(' ') === tokens(b).join(' ');

// Repeated steps go (also ones that only differ by a contraction: "I am" / "I'm"); the first of two repeats stays, except that the final step is never lost
export function dedupeSteps(steps) {
  if (!steps.length) return steps;
  const last = steps[steps.length - 1];
  return steps.filter((s, i, all) => i === all.length - 1 || (!sameEnglish(s.en, last.en) && all.findIndex((x) => sameEnglish(x.en, s.en)) === i));
}

// The English part to build up to: the model's `english` if it really is the source without a quotation, else our own cut of the source
export function pickEnglish(source, modelEnglish) {
  const m = clean(modelEnglish, 400);
  if (m && (sameEnglish(m, source) || foreignTokens(source, m).size)) return m;
  return englishPart(source);
}

// Words after the previous step's words are the new ones: [[marked]] (nothing is marked when the step does not continue the previous one)
function markNew(english, previous) {
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const now = english.split(/\s+/);
  const before = previous ? stripBrackets(previous).split(/\s+/).filter(Boolean) : [];
  if (!before.length || before.length >= now.length || !before.every((w, i) => norm(w) === norm(now[i]))) return english;
  return `${now.slice(0, before.length).join(' ')} [[${now.slice(before.length).join(' ')}]]`;
}

// A long source ends with its English part word for word: a step that already is it ends the ladder, otherwise the last step is replaced by it
export function enforceFinal(steps, english) {
  const at = steps.findIndex((s) => sameEnglish(s.en, english));
  if (at >= 0) return steps.slice(0, at + 1);
  const last = steps[steps.length - 1];
  return [...steps.slice(0, -1), { ...last, en: markNew(english, steps[steps.length - 2]?.en) }];
}

// More steps than the ladder allows: drop interior steps evenly (never the first step nor the last two)
export function capSteps(steps, max = DRILL_MAX) {
  const extra = steps.length - max;
  if (extra <= 0) return steps;
  const interior = steps.map((_, i) => i).slice(1, -2);
  const drop = new Set(Array.from({ length: extra }, (_, k) => interior[Math.floor(((k + 0.5) * interior.length) / extra)]));
  return steps.filter((_, i) => !drop.has(i));
}

export async function drill({ apiKey, model, generate, sentence, context, lang, level }) {
  const out = await gen({ apiKey, model, generate })({ prompt: drillPrompt({ sentence, context, lang, level }), schema: DRILL_SCHEMA, temperature: 0.6 });
  const english = pickEnglish(sentence, out.english);
  const foreign = foreignTokens(sentence, english);
  let steps = (Array.isArray(out.steps) ? out.steps : [])
    .map((s) => ({
      label: clean(s.label, 40),
      native: clean(s.native ?? s.tr, 300).replace(/\[\[|\]\]/g, ''),
      en: clean(s.en, 300),
      alternatives: (Array.isArray(s.alternatives) ? s.alternatives : []).map((a) => clean(a, 300).replace(/\[\[|\]\]/g, '')).filter(Boolean).slice(0, 5),
      hint: clean(s.hint, 60).replace(/\[\[|\]\]/g, '')
    }))
    .filter((s) => s.native && s.en)
    // steps that contain a word of the foreign quotation of the source are not practised
    .filter((s) => !foreign.size || !tokens(s.en).some((w) => foreign.has(w)))
    // a translation with "…" placeholders is no use for a speaking drill (kept only if that would leave too few steps)
    .filter((s, i, all) => i === all.length - 1 || !/…|\.\.\./.test(s.native) || all.filter((x) => !/…|\.\.\./.test(x.native)).length < 3);
  steps = dedupeSteps(steps);
  if (steps.length < 3) throw new AIError('AI_FAILED', 'The AI returned too few steps.');
  const long = wordCount(english) > DRILL_SHORT;
  if (long) steps = enforceFinal(steps, english);
  return { pattern: clean(out.pattern, 200), explanation: clean(out.explanation, 600), notes: cleanNotes(out.notes), steps: capSteps(dropDanglingSteps(steps, long ? DRILL_MIN : 3)) };
}
