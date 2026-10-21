// Spaced-repetition scheduler (a simplified SM-2), shared by the server and the browser.
// review: { reps, interval (days), ease, lapses, due (ms) }
export const GRADES = ['again', 'hard', 'good', 'easy'];
const DAY = 24 * 60 * 60 * 1000;
export const AGAIN_DELAY = 10 * 60 * 1000;

export function schedule(review, grade, now = Date.now()) {
  const r = { reps: 0, interval: 0, ease: 2.5, lapses: 0, ...review };
  if (grade === 'again') {
    return { ...r, reps: 0, interval: 0, lapses: r.lapses + 1, ease: Math.max(1.3, r.ease - 0.2), due: now + AGAIN_DELAY };
  }
  let interval;
  let ease = r.ease;
  if (grade === 'hard') {
    interval = Math.max(1, Math.round(r.interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
  } else if (grade === 'good') {
    interval = r.reps === 0 ? 1 : r.reps === 1 ? 3 : Math.round(r.interval * ease);
  } else if (grade === 'easy') {
    interval = r.reps === 0 ? 3 : Math.round(Math.max(1, r.interval) * ease * 1.3);
    ease += 0.15;
  } else {
    throw new Error(`Unknown grade: ${grade}`);
  }
  return { ...r, reps: r.reps + 1, interval, ease: +ease.toFixed(2), due: now + interval * DAY };
}

export const isDue = (item, now = Date.now()) => (item.review?.due ?? 0) <= now;
