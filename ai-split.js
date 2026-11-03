// "Split into short parts with AI": the whole transcript of a video is cut by the AI into short, meaningful pieces (one idea
// each, sized for the learner's level) and every piece is translated with its context. Docs: docs/AI.md → "AI split"
//
//   words.json ──► batches of ~200 words (at original card boundaries) ──► AI: { pieces: [{ en, tr }] }
//              ──► pieces checked against the transcript and mapped back to word indexes ──► cards (word times, silences)
//
// The AI never changes the English: a piece's text is always rebuilt from the transcript words, so the timing stays exact.
// A batch whose answer does not reproduce the transcript is retried once with a stricter instruction, then aligned word by
// word (accepted when ≥ 98 % of the words line up), and otherwise keeps its original cards. No word is ever lost or reordered.
import { findLanguage } from './languages.js';
import { AIError } from './gemini.js';
import { CARD, cardsFromSentences } from './segmenter.js';

export const AI_SPLIT_VERSION = 1;

// Piece length per level (words). `min` is a soft target: a short sentence may stay shorter.
export const PIECE_WORDS = { A2: { min: 3, max: 8 }, B1: { min: 5, max: 14 }, B2: { min: 6, max: 18 }, C1: { min: 8, max: 24 } };

export const BATCH = {
  target: 200, // words per AI request (a batch ends at the first original card boundary after this many words)
  max: 300, // never more, unless a single original card is longer
  context: 40, // words of context before and after a batch ("context only")
  longPause: 1.5, // s: a silence this long after punctuation is a hard boundary ("‖")
  hardPause: 3, // s: … and anywhere when it is this long
  minAligned: 0.98, // share of the batch's words the fallback alignment must match
  concurrency: 2
};

const MARK = '‖'; // a long pause or a removed non-speech part: a piece always ends there

/* ---------- Non-speech annotations ---------- */

// "(speaking in foreign language)", "[Music]", "(Applause)", "♪" … are descriptions, not speech: they belong to no piece.
// Bracketed text that is speech ("(SAW)", an Arabic phrase in parentheses) is kept.
const NON_SPEECH = new RegExp('^(?:' + [
  'speaking (?:in )?(?:a )?(?:foreign|non-english|other|another) language',
  '(?:speaking|speaks?|singing|reciting|praying)(?: in)? [a-z-]+',
  'foreign(?: language)?', 'non-english(?: speech)?', 'in [a-z-]+',
  '(?:[a-z]+ )?music(?: playing| continues| fades(?: out)?| ends)?', 'music and applause',
  '(?:audience )?(?:applause|applauding|clapping|cheering|cheers|laughter|laughing|laughs)',
  'chuckles?', 'inaudible', 'indistinct(?: [a-z]+)?', 'crosstalk', 'silence', 'blank_audio', 'no audio', '(?:background )?noise',
  'coughs?', 'coughing', 'sighs?', 'breathing', 'beep', 'static', 'singing', 'recitation', 'reciting', 'speaks? arabic'
].join('|') + ')$', 'i');

const OPENS = /^[([]/;
const CLOSES = /[)\]][.,;:!?"'”’]*$/;
const MUSIC = /^[♪♫#*]+[.,]?$/;

// Indexes of the words that are non-speech annotations
export function annotationMask(words) {
  const mask = new Array(words.length).fill(false);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].w;
    if (MUSIC.test(w)) { mask[i] = true; continue; }
    if (!OPENS.test(w)) continue;
    for (let j = i; j < Math.min(words.length, i + 8); j++) {
      if (!CLOSES.test(words[j].w)) continue;
      const inner = words.slice(i, j + 1).map((x) => x.w).join(' ').replace(/^[([\s]+|[)\]\s.,;:!?"'”’]+$/g, '').replace(/[_\s]+/g, (m) => (m.includes('_') ? '_' : ' ')).trim();
      if (NON_SPEECH.test(inner) || /^[♪♫\s]*$/.test(inner)) for (let k = i; k <= j; k++) mask[k] = true;
      break;
    }
  }
  return mask;
}

/* ---------- Original cards → word ranges, batches ---------- */

const tokensOf = (text) => String(text || '').split(/\s+/).filter(Boolean);

// [from, to) word ranges of the original cards. Cards are built from the same words, so their tokens line up one to one;
// if they do not (an older transcript), each word goes to the card that contains its midpoint.
export function cardWordRanges(cards, words) {
  const ranges = [];
  let at = 0;
  let ok = true;
  for (const card of cards) {
    const n = tokensOf(card.text).length;
    const slice = words.slice(at, at + n).map((x) => x.w).join(' ');
    if (slice !== tokensOf(card.text).join(' ')) { ok = false; break; }
    ranges.push([at, at + n]);
    at += n;
  }
  if (ok && at === words.length) return ranges;

  // each word belongs to the first card that ends after its midpoint (monotonic, so the ranges touch and keep their order)
  const owner = words.map((x) => {
    const mid = (x.s + x.e) / 2;
    const k = cards.findIndex((c) => mid < c.end);
    return k < 0 ? cards.length - 1 : k;
  });
  for (let i = 1; i < owner.length; i++) owner[i] = Math.max(owner[i], owner[i - 1]);
  let from = 0;
  return cards.map((_, k) => {
    let to = from;
    while (to < words.length && owner[to] === k) to++;
    const r = [from, to];
    from = to;
    return r;
  });
}

// Groups original cards into batches of about BATCH.target words: [{ from, to, cards: [k…] }]
export function planBatches(ranges, opts = {}) {
  const cfg = { ...BATCH, ...opts };
  const batches = [];
  let cur = null;
  ranges.forEach(([from, to], k) => {
    if (cur && cur.to - cur.from >= cfg.target) cur = null;
    if (cur && to - cur.from > cfg.max) cur = null;
    if (!cur) { cur = { from, to, cards: [] }; batches.push(cur); }
    cur.to = to;
    cur.cards.push(k);
  });
  // A short last batch joins the previous one when that stays within the maximum
  const last = batches.at(-1);
  const prev = batches.at(-2);
  if (last && prev && last.to - last.from < cfg.target / 3 && last.to - prev.from <= cfg.max) {
    prev.to = last.to;
    prev.cards.push(...last.cards);
    batches.pop();
  }
  return batches;
}

/* ---------- Hard boundaries (‖) ---------- */

// Words followed by a long pause: each silence of at least `minPause` s belongs to the last word that starts before it.
// Whisper's word times are only accurate to about one word around a pause, so the boundary goes where the punctuation
// says it is (that word or the one before it). A pause without punctuation is a boundary only when it is very long
// (`hardPause`): a speaker who hesitates in the middle of a phrase ("in the … masjid") must not get the phrase cut.
export function pauseBreaks(words, silences, minPause = BATCH.longPause, hardPause = BATCH.hardPause) {
  const out = new Set();
  const ends = (k) => k >= 0 && /[.,;:!?…"”)\]]$/.test(words[k].w);
  let i = 0;
  for (const x of [...silences].sort((p, q) => p.a - q.a)) {
    if (x.b - x.a < minPause) continue;
    while (i + 1 < words.length && words[i + 1].s <= x.a + 0.05) i++;
    if (!words[i] || words[i].s > x.a + 0.05) continue;
    // a word Whisper placed entirely inside the silence (a quiet "you.") still belongs before the pause
    let k = i;
    while (k + 1 < words.length && words[k + 1].s >= x.a && words[k + 1].e <= x.b + 0.05) k++;
    const at = ends(k) ? k : ends(k - 1) ? k - 1 : x.b - x.a >= hardPause ? k : -1;
    if (at >= 0 && at < words.length - 1) out.add(at);
  }
  return out;
}

// The speech words of [from, to) and, for each, whether a hard boundary follows it (an annotation or a long pause)
export function speechOf(words, breaks, mask, from, to) {
  const idx = [];
  for (let i = from; i < to; i++) if (!mask[i]) idx.push(i);
  const breakAfter = idx.map((i, k) => {
    const next = idx[k + 1];
    if (next === undefined) return false;
    return next !== i + 1 || breaks.has(i);
  });
  return { idx, breakAfter };
}

/* ---------- Prompt ---------- */

const languageName = (code) => findLanguage(code)?.name || 'English';

export const SPLIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pieces: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, tr: { type: 'STRING' } }, required: ['en', 'tr'], propertyOrdering: ['en', 'tr'] }
    }
  },
  required: ['pieces'],
  propertyOrdering: ['pieces']
};

// The batch as the AI sees it: the words with " ‖ " at hard boundaries
export function batchText(words, { idx, breakAfter }) {
  return idx.map((i, k) => words[i].w + (breakAfter[k] ? ` ${MARK}` : '')).join(' ');
}

export function splitPrompt({ text, before = '', after = '', lang, level = 'B1', strict = '' }) {
  const language = languageName(lang);
  const size = PIECE_WORDS[level] || PIECE_WORDS.B1;
  return [
    `You prepare subtitles for a ${language}-speaking learner of English at CEFR level ${level}.`,
    'Below is part of the transcript of a spoken talk. Cut it into short, meaningful pieces that are easy to read and understand one at a time, and translate every piece.',
    '',
    'RULES FOR "en" (the English piece):',
    '- Copy the transcript EXACTLY: every word in its order, with the same spelling, capitals and punctuation. Do not add, remove, correct, reorder or repeat anything. All "en" values joined with spaces must give back the transcript word for word (without the ‖ signs).',
    `- One idea per piece: a short sentence, a clause or a phrase that makes sense on its own. For level ${level} a piece has about ${size.min} to ${size.max} words. Count the words: a piece longer than ${size.max} words must be cut again at its best clause boundary (only a single phrase that cannot be cut may stay longer). A short sentence can stay shorter.`,
    '- Cut where a speaker naturally pauses: after . ? !, after a comma that ends a clause, before a new clause (and, but, because, so, that, which, when, if, then …), between the items of a list, before and after a quotation.',
    '- Never cut inside a phrase: not between an article or adjective and its noun, a verb and its object or particle, a preposition and its object, "going to / have to / want to" and the verb, or the parts of a name.',
    `- "${MARK}" marks a long pause or a removed non-speech part. A piece always ends at ${MARK} and the next piece starts after it. Never put ${MARK} inside a piece and do not copy it.`,
    '- Words in another language (transliterated Arabic, a verse, a prayer) stay where they are, in their own short piece when possible.',
    '',
    `RULES FOR "tr" (the translation, written in ${language}):`,
    `- A natural, correct ${language} translation of exactly that piece, as it is meant in this talk (use the context and the neighbouring pieces).`,
    `- When a piece is only part of a sentence, translate that part so that the translations read naturally one after another; do not repeat words that belong to the next piece.`,
    '- Keep names and words in another language as they are (or in their usual written form). Do not add explanations.',
    '',
    'EXAMPLE of where to cut (English only):',
    'Transcript: "And I don\'t mean to criticize anybody personally or any institution, but when we teach our children to memorize the Quran without ever making them think about it, we lose something. Right?"',
    'Pieces: "And I don\'t mean to criticize anybody personally" | "or any institution," | "but when we teach our children to memorize the Quran" | "without ever making them think about it," | "we lose something." | "Right?"',
    strict ? `\nIMPORTANT: ${strict}` : '',
    '',
    before ? `CONTEXT BEFORE (only for understanding, do not split or translate it):\n${before}\n` : '',
    `TRANSCRIPT TO SPLIT:\n${text}`,
    after ? `\nCONTEXT AFTER (only for understanding, do not split or translate it):\n${after}` : '',
    '',
    'Return JSON: { "pieces": [ { "en": "…", "tr": "…" } ] }, the pieces in transcript order.'
  ].filter((l) => l !== '').join('\n');
}

/* ---------- Checking the answer ---------- */

// Token comparison ignores what does not change the timing: case, curly vs straight quotes, dashes, Unicode forms, and
// quotation marks or brackets around a word (models often drop the opening quote of a batch that starts inside a quotation).
// The text of a card is always taken from the transcript, so none of these reach the subtitles.
const norm = (t) => String(t).normalize('NFC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-').replace(/[​-‍﻿]/g, '');
const edge = (t) => norm(t).replace(/^["'([]+|["')\]]+$/g, '') || norm(t);
// Looser form for the word alignment: letters and digits only
const bare = (t) => norm(t).replace(/[^\p{L}\p{N}']/gu, '').replace(/^'+|'+$/g, '');

const cleanPieces = (out) =>
  (Array.isArray(out?.pieces) ? out.pieces : [])
    .map((p) => ({ en: String(p?.en ?? '').replace(/\s+/g, ' ').trim(), tr: String(p?.tr ?? p?.translation ?? '').replace(/\s+/g, ' ').trim().slice(0, 600) }))
    .filter((p) => p.en.replace(new RegExp(MARK, 'g'), '').trim());

// Exact check: the pieces, joined, are the batch text. Returns the pieces as runs of positions in `idx` ([from, to) into the
// batch's speech words), or { error } with a short description of the first difference.
export function exactAlign(pieces, batchWords) {
  const out = [];
  let at = 0;
  let crossings = 0;
  for (const p of pieces) {
    const toks = tokensOf(p.en.replace(new RegExp(MARK, 'g'), ` ${MARK} `));
    // a ‖ inside a piece (not at its ends) means the piece runs over a hard boundary
    const inner = toks.slice(1, -1).filter((x) => x === MARK).length;
    crossings += inner;
    const words = toks.filter((x) => x !== MARK);
    if (!words.length) continue;
    for (const w of words) {
      if (at >= batchWords.length) return { error: `extra text at the end: "${w}"` };
      if (edge(w) !== edge(batchWords[at])) return { error: `"${w}" where the transcript has "${batchWords[at]}" (word ${at + 1})` };
      at++;
    }
    out.push({ from: at - words.length, to: at, tr: p.tr });
  }
  if (at < batchWords.length) return { error: `the pieces stop before the end of the transcript, at "${batchWords[at]}" (word ${at + 1})` };
  return { runs: out, crossings };
}

// Fallback: aligns the pieces' words with the transcript (longest common subsequence). Accepted when at least
// `minAligned` of the transcript words are matched; unmatched transcript words join the piece of the word before them.
export function lcsAlign(pieces, batchWords, minAligned = BATCH.minAligned) {
  const ai = [];
  pieces.forEach((p, k) => tokensOf(p.en).forEach((w) => { const b = bare(w); if (b) ai.push({ b, k }); }));
  const tw = batchWords.map(bare);
  const n = tw.length;
  const m = ai.length;
  if (!n || !m) return null;
  // DP table of LCS lengths (batches are a few hundred words, so n × m stays small)
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i][j] = tw[i] && tw[i] === ai[j].b ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const owner = new Array(n).fill(-1);
  let matched = 0;
  for (let i = 0, j = 0; i < n && j < m;) {
    if (tw[i] && tw[i] === ai[j].b) { owner[i] = ai[j].k; matched++; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const countable = tw.filter(Boolean).length || 1;
  if (matched / countable < minAligned || matched / m < 0.9) return null;
  // unmatched words: the piece of the previous word (the next one at the very start)
  const firstOwner = owner.find((x) => x >= 0);
  for (let i = 0; i < n; i++) if (owner[i] < 0) owner[i] = i ? owner[i - 1] : firstOwner;
  const runs = [];
  owner.forEach((k, i) => {
    const last = runs.at(-1);
    if (last && last.k === k) last.to = i + 1;
    else runs.push({ k, from: i, to: i + 1, tr: pieces[k].tr });
  });
  return { runs: runs.map(({ from, to, tr }) => ({ from, to, tr })), matched, total: n };
}

// Cuts runs that cross a hard boundary. The translation stays with the larger part; a small leftover joins the
// neighbouring piece on its other side when no boundary lies between them, or keeps an empty translation.
export function splitAtBreaks(runs, breakAfter) {
  const out = [];
  for (const r of runs) {
    const parts = [];
    let from = r.from;
    for (let k = r.from; k < r.to - 1; k++) if (breakAfter[k]) { parts.push({ from, to: k + 1 }); from = k + 1; }
    parts.push({ from, to: r.to });
    if (parts.length === 1) { out.push({ ...r }); continue; }
    let main = 0;
    parts.forEach((p, k) => { if (p.to - p.from > parts[main].to - parts[main].from) main = k; });
    parts.forEach((p, k) => out.push({ from: p.from, to: p.to, tr: k === main ? r.tr : '', leftover: k !== main, side: k < main ? 'before' : 'after' }));
  }
  // leftovers before the main part join the previous piece, those after it join the next piece, when no boundary separates them
  for (let k = 0; k < out.length; k++) {
    const p = out[k];
    if (!p.leftover) continue;
    if (p.side === 'before' && k > 0 && !out[k - 1].leftover && out[k - 1].to === p.from && !breakAfter[p.from - 1]) {
      out[k - 1].to = p.to; out.splice(k--, 1);
    } else if (p.side === 'after' && k < out.length - 1 && !out[k + 1].leftover && out[k + 1].from === p.to && !breakAfter[p.to - 1]) {
      out[k + 1].from = p.from; out.splice(k--, 1);
    }
  }
  return out.map(({ from, to, tr }) => ({ from, to, tr }));
}

/* ---------- One batch ---------- */

const FATAL = new Set(['NO_AI_KEY', 'AI_KEY_INVALID', 'AI_QUOTA', 'AI_OFFLINE', 'AI_MODEL']);

// Asks the AI for one batch. Returns { runs, mode: 'exact' | 'aligned' | 'original', attempts, issues }.
// runs: [{ from, to, tr }] as positions into the batch's speech words. Fatal AI errors (no key, quota, offline …) are thrown.
export async function splitBatch({ generate, words, speech, before, after, lang, level }) {
  const batchWords = speech.idx.map((i) => words[i].w);
  const text = batchText(words, speech);
  let strict = '';
  let crossed = null; // an exact answer that ran over a ‖ (used if the retry is worse)
  const answers = [];
  const issues = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let pieces;
    try {
      pieces = cleanPieces(await generate({ prompt: splitPrompt({ text, before, after, lang, level, strict }), schema: SPLIT_SCHEMA, temperature: 0.2 }));
    } catch (e) {
      if (!(e instanceof AIError) || FATAL.has(e.code)) throw e;
      issues.push(`${e.code}: ${e.message}`.slice(0, 160));
      strict = 'Answer with valid JSON only, exactly in the requested structure.';
      continue;
    }
    answers.push(pieces);
    const exact = exactAlign(pieces, batchWords);
    if (exact.runs && (exact.crossings === 0 || attempt === 2)) {
      return { runs: splitAtBreaks(exact.runs, speech.breakAfter), mode: 'exact', attempts: attempt, issues };
    }
    if (exact.runs) crossed = exact;
    issues.push((exact.runs ? `${exact.crossings} piece(s) ran over ${MARK}` : exact.error).slice(0, 160));
    strict = exact.runs
      ? `Your previous answer put "${MARK}" inside a piece. A piece must always end at "${MARK}".`
      : `Your previous answer did not reproduce the transcript exactly (${exact.error}). Copy every word exactly as written, in the same order, without adding, removing, correcting or repeating anything. Only choose where to cut.`;
  }
  if (crossed) return { runs: splitAtBreaks(crossed.runs, speech.breakAfter), mode: 'exact', attempts: 2, issues };
  const aligned = answers.map((p) => (p.length ? lcsAlign(p, batchWords) : null)).filter(Boolean).sort((x, y) => y.matched - x.matched)[0];
  if (aligned) return { runs: splitAtBreaks(aligned.runs, speech.breakAfter), mode: 'aligned', attempts: 2, issues };
  return { runs: null, mode: 'original', attempts: 2, issues };
}

/* ---------- Whole video ---------- */

const round = (x) => +x.toFixed(2);

// Pieces → cards: words give the text and the times (snapped to silences, padded like normal cards), one piece per card
export function piecesToCards(pieces, words, silences) {
  const sentences = pieces.map((p) => {
    const ws = p.idx.map((i) => words[i]);
    const first = p.idx[0];
    const last = p.idx.at(-1);
    return {
      words: ws,
      text: ws.map((x) => x.w).join(' '),
      tr: p.tr || '',
      // the word really spoken before / after (an annotation that is not part of any piece still marks where speech stops)
      prevWord: first > 0 ? words[first - 1] : null,
      nextWord: last < words.length - 1 ? words[last + 1] : null,
      first,
      last
    };
  });
  const cards = cardsFromSentences(sentences, silences, { ...CARD, pack: false });
  // Safety net: strictly increasing, non-overlapping, never empty
  for (let k = 0; k < cards.length; k++) {
    const c = cards[k];
    const next = cards[k + 1];
    if (next && c.end > next.start) {
      const mid = round((Math.max(c.start, next.start) + Math.min(c.end, next.end)) / 2);
      c.end = Math.max(round(c.start + 0.05), mid);
      next.start = c.end;
    }
    if (c.end <= c.start) c.end = round(c.start + 0.1);
    if (next && next.start < c.end) next.start = c.end;
    c.sentTimes = [[c.start, c.end]];
  }
  return cards.map((c, k) => ({ ...c, tr: sentences[k].tr, trParts: [sentences[k].tr] }));
}

// words, silences: words.json; cards: the original cards; generate: the provider router's generate
// onProgress(done, total). originalTr: the original cards' translations are in `lang` (used for a batch the AI could not split).
// Returns { cards, stats }.
export async function splitTranscript({ words, silences = [], cards, generate, lang, level = 'B1', originalTr = true, onProgress = () => {}, opts = {} }) {
  const cfg = { ...BATCH, ...opts };
  const mask = annotationMask(words);
  const breaks = pauseBreaks(words, silences, cfg.longPause, cfg.hardPause);
  const ranges = cardWordRanges(cards, words);
  const batches = planBatches(ranges, cfg);
  const speechWords = words.map((_, i) => i).filter((i) => !mask[i]);
  const ctx = (from, to) => speechWords.filter((i) => i >= from && i < to).map((i) => words[i].w).join(' ');

  const results = new Array(batches.length);
  let next = 0;
  let done = 0;
  onProgress(0, batches.length);
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next];
      const k = next++;
      const speech = speechOf(words, breaks, mask, b.from, b.to);
      if (!speech.idx.length) { results[k] = { b, speech, runs: [], mode: 'empty' }; } else {
        const beforeIdx = speechWords.filter((i) => i < b.from).slice(-cfg.context);
        const afterIdx = speechWords.filter((i) => i >= b.to).slice(0, cfg.context);
        const r = await splitBatch({
          generate, words, speech, lang, level,
          before: beforeIdx.length ? ctx(beforeIdx[0], beforeIdx.at(-1) + 1) : '',
          after: afterIdx.length ? ctx(afterIdx[0], afterIdx.at(-1) + 1) : ''
        });
        results[k] = { b, speech, ...r };
      }
      onProgress(++done, batches.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, batches.length) }, worker));

  // Pieces as word indexes. A batch the AI could not split keeps its original cards (their local translation, if any).
  const pieces = [];
  for (const { b, speech, runs, mode } of results) {
    if (mode === 'empty') continue;
    if (runs) {
      for (const r of runs) pieces.push({ idx: speech.idx.slice(r.from, r.to), tr: r.tr });
      continue;
    }
    for (const k of b.cards) {
      const [from, to] = ranges[k];
      const own = speechOf(words, breaks, mask, from, to);
      if (!own.idx.length) continue;
      const card = cards[k];
      for (const r of splitAtBreaks([{ from: 0, to: own.idx.length, tr: originalTr ? card.tr || '' : '' }], own.breakAfter)) {
        pieces.push({ idx: own.idx.slice(r.from, r.to), tr: r.tr });
      }
    }
  }
  const stats = {
    batches: batches.length,
    exact: results.filter((r) => r.mode === 'exact').length,
    aligned: results.filter((r) => r.mode === 'aligned').length,
    original: results.filter((r) => r.mode === 'original').length,
    retried: results.filter((r) => r.attempts > 1).length,
    annotations: mask.filter(Boolean).length,
    issues: results.flatMap((r, k) => (r.issues || []).map((x) => `batch ${k + 1}: ${x}`)).slice(0, 20)
  };
  if (batches.length && stats.original === batches.length) throw new AIError('AI_FAILED', 'The AI could not split this transcript.');
  return { cards: piecesToCards(pieces, words, silences), stats };
}

// Words covered by the cards, for checks: every speech word exactly once, in order
export function coverage(cards, words) {
  const mask = annotationMask(words);
  const expected = words.filter((_, i) => !mask[i]).map((x) => x.w);
  const got = cards.flatMap((c) => tokensOf(c.text));
  let overlaps = 0;
  for (let k = 1; k < cards.length; k++) if (cards[k].start < cards[k - 1].end - 1e-9) overlaps++;
  return { expected: expected.length, got: got.length, same: expected.join(' ') === got.join(' '), overlaps };
}
