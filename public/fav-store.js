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

export const findVideoFav = (projectId, cardIndex, sentIndex) =>
  items.find((x) => x.kind === 'video' && x.projectId === projectId && x.cardIndex === cardIndex && x.sentIndex === sentIndex) || null;
export const findExampleFav = (text) => items.find((x) => x.kind === 'example' && x.text === text) || null;

export async function addVideoFav(projectId, cardIndex, sentIndex) {
  const item = await api('/api/favorites', { method: 'POST', body: { projectId, cardIndex, sentIndex } });
  await loadFavorites();
  return item;
}

export async function addExampleFav({ text, tr, pattern, source }) {
  const item = await api('/api/favorites', { method: 'POST', body: { kind: 'example', text, tr, pattern, source } });
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
