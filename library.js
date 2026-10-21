// Finds real sentences in your own library that use a given pattern (searched by short literal phrases).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidId } from './config.js';

const normalize = (s) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Sentences of a card with their translation part and times (older cards without sentTimes fall back to the card)
function sentencesOfCard(card) {
  const sents = card.sents?.length ? card.sents : [card.text];
  const parts = card.trParts?.length === sents.length ? card.trParts : null;
  return sents.map((text, k) => ({
    text,
    tr: parts ? parts[k] : sents.length === 1 ? card.tr || '' : '',
    start: card.sentTimes?.[k]?.[0] ?? card.start,
    end: card.sentTimes?.[k]?.[1] ?? card.end
  }));
}

export async function searchLibrary(dataDir, phrases, { exclude = '', limit = 5 } = {}) {
  const patterns = [...new Set(phrases.map(normalize).map((p) => p.trim()).filter((p) => p.length >= 3))]
    .map((p) => new RegExp(`(^|[^\\p{L}'])${escape(p)}($|[^\\p{L}'])`, 'u'));
  if (!patterns.length) return [];
  const skip = normalize(exclude).trim();
  const hits = [];
  for (const e of await readdir(dataDir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !isValidId(e.name)) continue;
    let project;
    try { project = JSON.parse(await readFile(path.join(dataDir, e.name, 'project.json'), 'utf8')); } catch { continue; }
    project.segments.forEach((card, cardIndex) => {
      sentencesOfCard(card).forEach((s, sentIndex) => {
        const text = normalize(s.text);
        if (text.trim() === skip) return;
        const score = patterns.filter((re) => re.test(text)).length;
        if (score) hits.push({ projectId: project.id, title: project.title, cardIndex, sentIndex, ...s, score });
      });
    });
  }
  // Best matches first; among equals, sentences of a comfortable length
  hits.sort((a, b) => b.score - a.score || Math.abs(a.text.length - 70) - Math.abs(b.text.length - 70));
  return hits.slice(0, limit);
}

export { sentencesOfCard };
