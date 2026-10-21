// Compares what the learner said (as transcribed) with the expected English sentence.
// Shared by the browser and the tests. Contractions, punctuation and case do not matter.

const CONTRACTIONS = {
  "i'm": 'i am', "you're": 'you are', "he's": 'he is', "she's": 'she is', "it's": 'it is', "we're": 'we are', "they're": 'they are',
  "i've": 'i have', "you've": 'you have', "we've": 'we have', "they've": 'they have', "i'll": 'i will', "you'll": 'you will',
  "he'll": 'he will', "she'll": 'she will', "we'll": 'we will', "they'll": 'they will', "i'd": 'i would', "you'd": 'you would',
  "he'd": 'he would', "she'd": 'she would', "we'd": 'we would', "they'd": 'they would', "that's": 'that is', "there's": 'there is',
  "what's": 'what is', "where's": 'where is', "who's": 'who is', "let's": 'let us', "can't": 'can not', "cannot": 'can not',
  "won't": 'will not', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "isn't": 'is not', "aren't": 'are not',
  "wasn't": 'was not', "weren't": 'were not', "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not',
  "couldn't": 'could not', "wouldn't": 'would not', "shouldn't": 'should not', "mustn't": 'must not', 'gonna': 'going to', 'wanna': 'want to'
};

// "I'm going to Istanbul!" → ['i', 'am', 'going', 'to', 'istanbul']
export function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\[\[|\]\]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (CONTRACTIONS[w] || w.replace(/'s$/, '')).split(' '));
}

// Longest common subsequence: which expected words were said, in order
function align(expected, heard) {
  const n = expected.length;
  const m = heard.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = expected[i] === heard[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (expected[i] === heard[j]) { matched[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return { common: dp[0][0], matched };
}

// Returns { verdict: 'good' | 'close' | 'wrong', score (0..1), target, words: [{ word, ok }], extra }
export function compareSpeech(heardText, expected, alternatives = []) {
  const heard = tokens(heardText);
  let best = null;
  for (const target of [expected, ...alternatives]) {
    const exp = tokens(target);
    if (!exp.length) continue;
    const { common, matched } = align(exp, heard);
    // Missed words and extra words both count: F1 of the two directions
    const recall = common / exp.length;
    const precision = heard.length ? common / heard.length : 0;
    const score = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
    if (!best || score > best.score) {
      best = { score, target, words: exp.map((word, i) => ({ word, ok: matched[i] })), extra: Math.max(0, heard.length - common) };
    }
  }
  if (!best) return { verdict: 'wrong', score: 0, target: expected, words: [], extra: heard.length };
  // 'good' only when (almost) every word is right: one missing "not" changes the meaning
  const verdict = best.score >= 0.95 ? 'good' : best.score >= 0.6 ? 'close' : 'wrong';
  return { verdict, ...best, score: +best.score.toFixed(2) };
}
