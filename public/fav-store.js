// Favorites state in the browser, kept in sync with /api/favorites.
import { api } from './util.js';
import { isDue } from './srs.js';

let items = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(items));

export const getFavorites = () => items;
export const dueFavorites = (now = Date.now()) => items.filter((x) => isDue(x, now));
export function onFavoritesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function loadFavorites() {
  try { items = (await api('/api/favorites')).items; } catch { items = []; }
  emit();
}

// The saved favorite for a sentence of a video ({ text, start, end }). Card indexes differ between the original cards and the
// AI split, so a sentence is matched by time: the same text, or the shorter of the two lies mostly inside the other (a long
// original sentence saved in one view lights up its short AI pieces in the other, and the other way round).
export function findVideoFav(projectId, sent) {
  const mine = items.filter((x) => x.kind === 'video' && x.projectId === projectId);
  const same = mine.find((x) => x.text === sent.text && Math.abs((x.start ?? 0) - sent.start) < 0.5);
  if (same) return same;
  return mine.find((x) => {
    if (!(x.end > x.start) || !(sent.end > sent.start)) return false;
    const overlap = Math.min(x.end, sent.end) - Math.max(x.start, sent.start);
    return overlap > 0.5 * Math.min(x.end - x.start, sent.end - sent.start);
  }) || null;
}
export const findExampleFav = (text) => items.find((x) => x.kind === 'example' && x.text === text) || null;

// view: which cards cardIndex refers to ('original' or 'ai'); the server stores the sentence's own text, translation and times
export async function addVideoFav(projectId, cardIndex, sentIndex, view = 'original') {
  const item = await api('/api/favorites', { method: 'POST', body: { projectId, cardIndex, sentIndex, view } });
  await loadFavorites();
  return item;
}

// kind: 'example' (from ✨ Vary) or 'drill' (a 🎯 Study sentence, reviewed from your language to English)
export async function addExampleFav({ kind = 'example', text, tr, pattern, source }) {
  const item = await api('/api/favorites', { method: 'POST', body: { kind, text, tr, pattern, source } });
  await loadFavorites();
  return item;
}

export async function removeFav(id) {
  await api(`/api/favorites/${id}`, { method: 'DELETE' });
  await loadFavorites();
}

export async function reviewFav(id, grade) {
  const updated = await api(`/api/favorites/${id}/review`, { method: 'POST', body: { grade } });
  items = items.map((x) => (x.id === id ? updated : x));
  emit();
  return updated;
}
