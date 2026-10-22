// Small helpers shared by the interface modules.
import { t } from './i18n.js';
import { LOCALES } from './locales.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const box = $('#toast');
  box.textContent = msg;
  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), ms);
}

// Message for an API error body { error, code }: translated when the code is known
export function apiError(body) {
  const key = `err.${body?.code}`;
  return (body?.code && LOCALES.en[key] ? t(key) : null) || body?.error || t('err.INTERNAL');
}

// fetch + JSON; throws an Error with a readable message and the server's error code
export async function api(url, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error(t('toast.serverDown')), { code: 'OFFLINE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(apiError(data)), { code: data.code, status: res.status });
  return data;
}

// localStorage that never throws (private windows, blocked storage)
export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* storage unavailable */ }
  return null;
}

// el('div.cls', { text, title, onclick, … }, children)
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name);
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...[].concat(children).filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// "She is [[good at]] chess." → text nodes and <mark> elements for the pattern words
export function highlightPattern(text) {
  return String(text).split(/(\[\[.*?\]\])/).filter(Boolean)
    .map((part) => (part.startsWith('[[') ? el('mark.pat', { text: part.slice(2, -2) }) : document.createTextNode(part)));
}

// replaceChildren that skips null / false / undefined (replaceChildren itself would print "null")
export function setChildren(node, ...children) {
  node.replaceChildren(...children.filter((c) => c !== null && c !== undefined && c !== false));
}

// Display name of an AI provider id
export const providerName = (id) => ({ gemini: 'Gemini', deepseek: 'DeepSeek' })[id] || id || '';

export const stripMarks = (text) => String(text).replace(/\[\[|\]\]/g, '');
