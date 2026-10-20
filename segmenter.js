// Builds subtitle cards from Whisper word timestamps, without ever splitting a sentence.
// Details: docs/SUBTITLE-CARDS.md
//
//   words (Whisper -ml 1 -sow) ──► sentences ──► times snapped to silences ──► cards
import { run } from './exec.js';
import { bin } from './config.js';

// Card packing settings (docs/SUBTITLE-CARDS.md → "Settings")
export const CARD = {
  maxChars: 120, // most characters in a merged card (a single longer sentence still gets its own card)
  maxSentences: 3, // most sentences in one card
  maxGap: 2.0, // s: start a new card if the silence between two sentences is longer
  maxDuration: 10, // s: a merged card never runs longer (a single sentence is exempt)
  startPad: 0.12, // s: lead-in before speech starts (so the first word is not clipped)
  endPad: 0.18, // s: tail after speech ends
  // Recordings without punctuation (Whisper sometimes stops writing it): sentence boundaries come from pauses
  minPunctDensity: 1 / 40, // "pause mode" when there are fewer sentence ends per word than this
  pauseBreak: 0.35, // s: a silence this long is a sentence boundary (pause mode only)
  minSentenceWords: 5, // fewest words in a sentence derived from pauses
  maxUnpunctuated: 200 // chars: a "sentence" longer than this AND without , ; : is unpunctuated speech and is split at pauses
};

const ABBREVIATIONS = new Set(['mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'st.', 'vs.', 'e.g.', 'i.e.', 'a.m.', 'p.m.', 'u.s.', 'no.']);
const SENTENCE_END = /[.?!…]["'”’)\]]*$/;

/* ---------- 1) Whisper output → words ---------- */

// Converts whisper-cli -ml 1 -sow output into a word list [{ w, s, e }] (seconds).
export function wordsFromWhisper(raw) {
  const list = raw.transcription || raw.result?.transcription || [];
  const words = [];
  for (const item of list) {
    const text = String(item.text ?? '');
    const t = text.trim();
    const s = (item.offsets?.from ?? 0) / 1000;
    const e = (item.offsets?.to ?? 0) / 1000;
    if (!t || /^\[.*\]$|^\(.*\)$/.test(t)) continue; // [BLANK_AUDIO], (music), …
    const prev = words[words.length - 1];
    // A piece that does not start with a space, or is only punctuation, continues the previous word
    if (prev && (!text.startsWith(' ') || !/[\p{L}\p{N}]/u.test(t))) {
      prev.w += t;
      prev.e = e;
    } else {
      words.push({ w: t, s, e });
    }
  }
  return words;
}

/* ---------- 2) Silence detection ---------- */

// Returns the silent intervals [{ a, b }] (seconds) of an audio file. The threshold adapts to the recording's average volume.
export async function detectSilences(wavPath) {
  const vol = await run(bin.ffmpeg, ['-nostats', '-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = parseFloat(/mean_volume:\s*(-?[\d.]+)/.exec(vol.err)?.[1] ?? '-32');
  const threshold = Math.min(-26, Math.max(-45, mean - 6));
  const { err } = await run(bin.ffmpeg, ['-nostats', '-i', wavPath, '-af', `silencedetect=noise=${threshold}dB:d=0.1`, '-f', 'null', '-']);
  const silences = [];
  let a = null;
  for (const line of err.split('\n')) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) a = Math.max(0, parseFloat(start[1]));
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && a !== null) { silences.push({ a, b: parseFloat(end[1]) }); a = null; }
  }
  return silences;
}

/* ---------- 3) Words → sentences ---------- */

function endsSentence(word, next) {
  if (!SENTENCE_END.test(word)) return false;
  const bare = word.toLowerCase().replace(/["'”’)\]]+$/, '');
  if (ABBREVIATIONS.has(bare) || /^\p{Lu}\.$/u.test(word)) return false; // "Dr." or an initial like "J."
  if (/(\.\.\.|…)["'”’)\]]*$/.test(word)) return !!next && /^["'“‘(]*\p{Lu}/u.test(next); // "…" only counts before a capital letter
  return true;
}

// Real sentence ends per word (punctuation density)
export function punctuationDensity(words) {
  const ends = words.filter((w, i) => endsSentence(w.w, words[i + 1]?.w)).length;
  return words.length ? ends / words.length : 1;
}

export function wordsToSentences(words, silences = [], opts = {}) {
  const cfg = { ...CARD, ...opts };
  const pauseMode = punctuationDensity(words) < cfg.minPunctDensity;
  const pausesAfter = (word) =>
    silences.some((x) => x.a >= word.s - 0.05 && x.a <= word.e + 0.3 && x.b - x.a >= cfg.pauseBreak);
  const make = (ws) => ({ words: ws, text: ws.map((x) => x.w).join(' ') });

  const sentences = [];
  let cur = [];
  words.forEach((word, i) => {
    cur.push(word);
    const pause = pauseMode && cur.length >= cfg.minSentenceWords && pausesAfter(word);
    if (endsSentence(word.w, words[i + 1]?.w) || pause || i === words.length - 1) {
      sentences.push(make(cur));
      cur = [];
    }
  });

  // Safety net: split long unpunctuated stretches (the recording stopped punctuating, or recited prayers) at pauses.
  // Long sentences with commas are real sentences and are never split.
  return sentences.flatMap((sent) => {
    if (sent.text.length <= cfg.maxUnpunctuated || /[,;:]/.test(sent.text)) return [sent];
    const parts = [];
    let chunk = [];
    sent.words.forEach((word, i) => {
      chunk.push(word);
      if ((chunk.length >= cfg.minSentenceWords && pausesAfter(word)) || i === sent.words.length - 1) {
        parts.push(make(chunk));
        chunk = [];
      }
    });
    return parts;
  });
}

/* ---------- 4) Snap times to silences ---------- */

const longest = (list) => list.reduce((best, x) => (!best || x.b - x.a > best.b - best.a ? x : best), null);

// Whisper includes the pause in a word's end time (measured: 0.4-1.5 s late), so the real end/start of speech between
// two sentences is taken from the silence in the audio. Without a silence, Whisper's time is kept.
function refineBoundary(prev, next, silences) {
  const t = prev ? prev.e : next.s;
  let endPrev = t;
  let startNext = t;
  if (prev) {
    // The silence has to start inside the last word's window
    const sil = longest(silences.filter((x) => x.a >= prev.s - 0.05 && x.a <= prev.e + 0.3));
    if (sil) {
      endPrev = sil.a;
      if (next && sil.b <= next.e + 0.15) startNext = sil.b;
    }
  } else if (next) {
    // Start of the video: a silence that ends inside the first word's window
    const sil = longest(silences.filter((x) => x.b >= next.s - 0.05 && x.b <= next.e));
    if (sil) startNext = sil.b;
  }
  return { endPrev, startNext };
}

/* ---------- 5) Sentences → cards ---------- */

// words: wordsFromWhisper output, silences: detectSilences output
// Returns cards: { start, end, text, sents: [sentence, …] }
export function buildCards(words, silences, opts = {}) {
  const cfg = { ...CARD, ...opts };
  const sentences = wordsToSentences(words, silences, cfg);
  if (!sentences.length) return [];

  // Sentence start/end times (snapped to silences)
  sentences.forEach((sent, i) => {
    const first = sent.words[0];
    const last = sent.words[sent.words.length - 1];
    const prevLast = sentences[i - 1]?.words.at(-1) ?? null;
    sent.start = refineBoundary(prevLast, first, silences).startNext;
    sent.end = refineBoundary(last, sentences[i + 1]?.words[0] ?? null, silences).endPrev;
    if (sent.end <= sent.start) sent.end = Math.max(last.e, sent.start + 0.1);
  });

  // Greedy packing: short sentences merge, a long sentence keeps its own card; a sentence is never split
  const cards = [];
  for (const sent of sentences) {
    const card = cards.at(-1);
    const chars = card ? card.sents.join(' ').length + 1 + sent.text.length : 0;
    const fits =
      card &&
      card.sents.length < cfg.maxSentences &&
      chars <= cfg.maxChars &&
      sent.start - card.end <= cfg.maxGap &&
      sent.end - card.start <= cfg.maxDuration;
    if (fits) {
      card.sents.push(sent.text);
      card.end = sent.end;
    } else {
      cards.push({ start: sent.start, end: sent.end, sents: [sent.text] });
    }
  }

  // Add padding; neighbouring cards must not overlap (if the silence is shorter than both pads, split it in the middle)
  const starts = cards.map((c) => c.start);
  const ends = cards.map((c) => c.end);
  cards.forEach((c, i) => {
    if (i === 0) c.start = Math.max(0, starts[0] - cfg.startPad);
    if (i === cards.length - 1) { c.end = ends[i] + 0.25; return; }
    const gapStart = ends[i];
    const gapEnd = starts[i + 1];
    const mid = (gapStart + gapEnd) / 2;
    const roomy = gapEnd - gapStart >= cfg.endPad + cfg.startPad;
    c.end = roomy ? gapStart + cfg.endPad : mid;
    cards[i + 1].start = roomy ? gapEnd - cfg.startPad : mid;
  });

  return cards.map((c) => ({
    start: +c.start.toFixed(2),
    end: +c.end.toFixed(2),
    text: c.sents.join(' '),
    sents: c.sents
  }));
}
