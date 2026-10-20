import { t, tn, getLang, setLang, applyI18n, localeOptions, languageName } from './i18n.js';
import { LOCALES } from './locales.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  projectList: $('#projectList'),
  projCount: $('#projCount'),
  newBtn: $('#newBtn'),
  emptyNewBtn: $('#emptyNewBtn'),
  settingsBtn: $('#settingsBtn'),
  drawerBtn: $('#drawerBtn'),
  drawerBackdrop: $('#drawerBackdrop'),
  sidebar: $('.sidebar'),
  hideVideoBtn: $('#hideVideoBtn'),
  mpTitle: $('#mpTitle'),
  mpShowVideo: $('#mpShowVideo'),
  mpPlay: $('#mpPlay'),
  mpSeek: $('#mpSeek'),
  mpTime: $('#mpTime'),
  empty: $('#empty'),
  home: $('#home'),
  homeStats: $('#homeStats'),
  searchInput: $('#searchInput'),
  videoGrid: $('#videoGrid'),
  workspace: $('#workspace'),
  video: $('#video'),
  videoTitle: $('#videoTitle'),
  videoStats: $('#videoStats'),
  deleteBtn: $('#deleteBtn'),
  subCount: $('#subCount'),
  trToggle: $('#trToggle'),
  colorToggle: $('#colorToggle'),
  trBar: $('#trBar'),
  trBarText: $('#trBarText'),
  trBarBtn: $('#trBarBtn'),
  trProgress: $('#trBar .tr-progress'),
  trProgressBar: $('#trProgressBar'),
  subSearch: $('#subSearch'),
  followBtn: $('#followBtn'),
  subList: $('#subList'),
  autoModeToggle: $('#autoModeToggle'),
  modal: $('#modal'),
  modalClose: $('#modalClose'),
  urlInput: $('#urlInput'),
  progress: $('#progress'),
  progressText: $('#progressText'),
  cancelBtn: $('#cancelBtn'),
  goBtn: $('#goBtn'),
  settings: $('#settings'),
  settingsClose: $('#settingsClose'),
  settingsDone: $('#settingsDone'),
  settingsIntro: $('#settingsIntro'),
  uiLangSelect: $('#uiLangSelect'),
  targetLangSelect: $('#targetLangSelect'),
  stWhisper: $('#stWhisper'),
  stTranslator: $('#stTranslator'),
  confirm: $('#confirm'),
  confirmText: $('#confirmText'),
  confirmYes: $('#confirmYes'),
  confirmNo: $('#confirmNo'),
  toast: $('#toast')
};

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ug']);

let projects = [];
let current = null;
let settings = { targetLang: null, languages: [], translator: { installed: false, running: false }, whisperModel: null };
let activeIndex = -1;
let toastTimer = null;
let lastPosSave = 0;
let manualScrollAt = 0;
let transcribing = false;
let showTr = store('showTr') !== 'false';
let colorSent = store('colorSent') !== 'false';
let textMode = store('textMode') === 'true';
let trPollId = 0;
let isAutoMode = store('autoMode') !== 'false';
let playUntil = null;
let loopIndex = -1;
let loopTimer = null;

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Message for an API error body { error, code }: translated when we know the code
function apiError(body) {
  const key = `err.${body?.code}`;
  const known = body?.code && LOCALES.en[key] ? t(key) : null;
  return known || body?.error || t('err.INTERNAL');
}

const titleOf = (p) => p.title || t('home.untitled');
const lowercase = (s) => { try { return s.toLocaleLowerCase(settings.targetLang || 'en'); } catch { return s.toLowerCase(); } };

/* ---------- Local storage (resume position, speed, toggles) ---------- */
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { return null; }
}

function savedPos(id) { return Number(store(`pos:${id}`)) || 0; }

function savePos(force) {
  if (!current || !els.video.duration) return;
  const now = Date.now();
  if (!force && now - lastPosSave < 2000) return;
  lastPosSave = now;
  const pos = els.video.currentTime;
  // At the very end: start from the beginning next time
  store(`pos:${current.id}`, pos > els.video.duration - 3 ? null : pos.toFixed(1));
}

/* ---------- Views & routing ---------- */
// #/ → home (video grid), #/v/<id> → video + subtitles
function showView(name) {
  els.empty.classList.toggle('hidden', name !== 'empty');
  els.home.classList.toggle('hidden', name !== 'home');
  els.workspace.classList.toggle('hidden', name !== 'workspace');
  els.drawerBtn.classList.toggle('hidden', name !== 'workspace');
  if (name !== 'workspace') {
    closeDrawer();
    savePos(true);
    els.video.pause();
    document.title = `YT Altyazı — ${t('home.title')}`;
  }
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const m = location.hash.match(/^#\/v\/([\w-]+)/);
  if (m && projects.some((p) => p.id === m[1])) return openProject(m[1]);
  if (m) history.replaceState(null, '', '#/');
  await loadProjects();
  showView(projects.length ? 'home' : 'empty');
}

/* ---------- Projects ---------- */
async function loadProjects() {
  try {
    projects = await fetch('/api/projects').then((r) => r.json());
  } catch {
    toast(t('toast.serverDown'));
    return;
  }
  renderProjectList();
  renderGrid();
}

function renderProjectList() {
  els.projCount.textContent = String(projects.length);
  els.projectList.innerHTML = '';
  for (const p of projects) {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.dataset.id = p.id;

    const title = document.createElement('span');
    title.className = 'project-title';
    title.textContent = titleOf(p);

    const meta = document.createElement('span');
    meta.className = 'project-meta';
    meta.textContent = tn('home.cards', p.segmentCount);

    li.append(title, meta);
    li.addEventListener('click', () => { closeDrawer(); go(`#/v/${p.id}`); });
    els.projectList.appendChild(li);
  }
  if (current) markActive(current.id);
}

function markActive(id) {
  els.projectList.querySelectorAll('.project-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

async function openProject(id) {
  if (current && current.id === id) return showView('workspace');
  savePos(true);
  stopLoop();

  let p;
  try {
    const r = await fetch(`/api/project/${id}`);
    if (!r.ok) throw new Error();
    p = await r.json();
  } catch {
    toast(t('toast.openFailed'));
    return go('#/');
  }

  current = p;
  activeIndex = -1;
  els.subSearch.value = '';
  els.video.src = `/api/project/${id}/video`;
  els.video.playbackRate = Number(store('rate')) || 1;
  els.videoTitle.textContent = titleOf(p);
  els.subCount.textContent = tn('subs.count', p.segments.length);
  document.title = `${titleOf(p)} — YT Altyazı`;
  applyTextMode();
  updateStats();
  showView('workspace');
  markActive(p.id);
  renderList();
  checkTranslation();
  els.subList.scrollTop = 0;
}

function updateStats() {
  if (!current) return;
  els.videoStats.textContent = tn('video.stats', current.segments.length);
}

/* ---------- Delete ---------- */
let confirmResolve = null;

function confirmDialog(text) {
  els.confirmText.textContent = text;
  els.confirm.classList.remove('hidden');
  els.confirmNo.focus();
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function closeConfirm(result) {
  if (!confirmResolve) return;
  els.confirm.classList.add('hidden');
  confirmResolve(result);
  confirmResolve = null;
}

async function deleteProject(id, title) {
  const ok = await confirmDialog(t('confirm.text', { title: title || t('home.untitled') }));
  if (!ok) return;
  try {
    const r = await fetch(`/api/project/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();
  } catch {
    return toast(t('toast.deleteFailed'));
  }
  store(`pos:${id}`, null);
  toast(t('toast.deleted'));
  if (current && current.id === id) {
    current = null;
    stopLoop();
    els.video.pause();
    els.video.removeAttribute('src');
    els.video.load();
  }
  await loadProjects();
  go('#/');
}

/* ---------- Home grid ---------- */
function youtubeId(url) {
  const m = String(url || '').match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function renderThumb(p) {
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  // Fall back to a frame of the local video when there is no YouTube thumbnail (offline, other sites)
  const localFrame = () => {
    const v = document.createElement('video');
    v.src = `/api/project/${p.id}/video#t=3`;
    v.preload = 'metadata';
    v.muted = true;
    thumb.prepend(v);
  };
  const ytId = youtubeId(p.url);
  if (ytId) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
    img.addEventListener('error', () => { img.remove(); localFrame(); });
    thumb.appendChild(img);
  } else {
    localFrame();
  }

  if (p.duration) {
    const dur = document.createElement('span');
    dur.className = 'duration';
    dur.textContent = fmtTime(p.duration);
    thumb.appendChild(dur);

    const pos = savedPos(p.id);
    if (pos > 0) {
      const bar = document.createElement('span');
      bar.className = 'watched';
      bar.style.width = `${Math.min(100, (pos / p.duration) * 100)}%`;
      thumb.appendChild(bar);
    }
  }

  const play = document.createElement('span');
  play.className = 'play';
  play.textContent = '▶';
  thumb.appendChild(play);

  const del = document.createElement('button');
  del.className = 'vcard-del';
  del.title = t('home.deleteTitle');
  del.setAttribute('aria-label', t('home.deleteTitle'));
  del.textContent = '🗑';
  del.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteProject(p.id, p.title);
  });
  thumb.appendChild(del);
  return thumb;
}

function renderGrid() {
  const q = lowercase(els.searchInput.value.trim());
  const list = q ? projects.filter((p) => lowercase(p.title || '').includes(q)) : projects;
  els.homeStats.textContent = tn('home.count', projects.length);

  els.videoGrid.innerHTML = '';
  const add = document.createElement('button');
  add.className = 'vcard vcard-new';
  add.innerHTML = '<span class="plus">＋</span>';
  add.append(Object.assign(document.createElement('span'), { textContent: t('home.newCard') }));
  add.addEventListener('click', openModal);
  els.videoGrid.appendChild(add);

  for (const p of list) {
    const card = document.createElement('a');
    card.className = 'vcard';
    card.href = `#/v/${p.id}`;

    const body = document.createElement('div');
    body.className = 'vcard-body';
    const title = document.createElement('h3');
    title.textContent = titleOf(p);
    title.title = p.title || '';
    const meta = document.createElement('p');
    meta.textContent = `${tn('home.cards', p.segmentCount)} · ${fmtDate(p.createdAt)}`;
    body.append(title, meta);

    card.append(renderThumb(p), body);
    els.videoGrid.appendChild(card);
  }

  if (q && !list.length) {
    const none = document.createElement('p');
    none.className = 'muted no-results';
    none.textContent = t('home.noResults', { q: els.searchInput.value.trim() });
    els.videoGrid.appendChild(none);
  }
}

/* ---------- Subtitle list ---------- */
function renderList() {
  els.subList.innerHTML = '';
  const frag = document.createDocumentFragment();
  current.segments.forEach((seg, i) => frag.appendChild(renderLine(seg, i)));
  els.subList.appendChild(frag);
  updateActive();
}

/* ---------- Sentences, words, colors ---------- */
// Same rule as the server: translator.js → splitSentences
const splitSentences = (s) => s.split(/(?<=[.?!…])\s+/).map((x) => x.trim()).filter(Boolean);
const SENT_COLORS = 3; // style.css → .sc0 … .sc2
// The sentences of a card: stored by the server as `sents` (older videos fall back to splitting at punctuation)
const sentencesOf = (seg) => (seg.sents && seg.sents.length ? seg.sents : splitSentences(seg.text));

// Splits the English text into sentences (coloured when a card has several) and clickable word spans
function renderEnglish(el, seg) {
  const sentences = sentencesOf(seg);
  const multi = sentences.length > 1;
  sentences.forEach((sentence, k) => {
    if (k) el.append(' ');
    let wrap = el;
    if (multi) {
      wrap = document.createElement('span');
      wrap.className = `s sc${k % SENT_COLORS}`;
    }
    for (const tok of sentence.split(/(\s+)/)) {
      if (!tok) continue;
      const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(tok);
      if (!m || !/\p{L}/u.test(m[2])) { wrap.append(tok); continue; }
      if (m[1]) wrap.append(m[1]);
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = m[2];
      wrap.appendChild(w);
      if (m[3]) wrap.append(m[3]);
    }
    if (multi) el.appendChild(wrap);
  });
}

// Writes the translation, split into parts that share the colors of the English sentences
function renderTr(el, seg) {
  el.textContent = '';
  const lang = current?.trLang || settings.targetLang;
  if (lang) { el.lang = lang; el.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr'; }
  if (!seg.tr) return;
  const n = sentencesOf(seg).length;
  let parts = seg.trParts;
  if (!parts || parts.length !== n) {
    const guess = splitSentences(seg.tr);
    parts = guess.length === n ? guess : null; // no colouring when they do not line up (never show a wrong pairing)
  }
  if (n < 2 || !parts) { el.textContent = seg.tr; return; }
  parts.forEach((part, k) => {
    if (k) el.append(' ');
    const s = document.createElement('span');
    s.className = `s sc${k % SENT_COLORS}`;
    s.textContent = part;
    el.appendChild(s);
  });
}

/* ---------- Word meaning ---------- */
const wordPop = document.createElement('div');
wordPop.className = 'word-pop hidden';
wordPop.addEventListener('click', (e) => e.stopPropagation());
const wordCache = new Map();
let wordToken = 0;

function closeWordPop() {
  wordPop.classList.add('hidden');
  document.querySelectorAll('.w.sel').forEach((x) => x.classList.remove('sel'));
}

function placeWordPop(wEl, line) {
  const lr = line.getBoundingClientRect();
  const wr = wEl.getBoundingClientRect();
  wordPop.style.top = `${wr.bottom - lr.top + 6}px`;
  const maxLeft = Math.max(0, lr.width - wordPop.offsetWidth - 8);
  wordPop.style.left = `${Math.min(Math.max(0, wr.left - lr.left), maxLeft)}px`;
}

async function showWordPop(wEl, line) {
  const word = wEl.textContent;
  const token = ++wordToken;
  document.querySelectorAll('.w.sel').forEach((x) => x.classList.remove('sel'));
  wEl.classList.add('sel');
  // Do not auto-scroll the list while the meaning is being read
  manualScrollAt = Date.now() + 6000;

  const fill = (nodes) => {
    wordPop.replaceChildren(...nodes);
    wordPop.dir = RTL_LANGUAGES.has(settings.targetLang) ? 'rtl' : 'ltr';
    line.appendChild(wordPop);
    wordPop.classList.remove('hidden');
    placeWordPop(wEl, line);
  };
  const span = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text });

  const key = `${settings.targetLang}:${word.toLowerCase()}`;
  let info = wordCache.get(key);
  if (!info) {
    fill([span('wp-word', word), span('wp-tr wp-wait', '…')]);
    try {
      const r = await fetch(`/api/word?w=${encodeURIComponent(word)}`);
      info = await r.json();
      if (!r.ok) throw new Error(apiError(info));
      wordCache.set(key, info);
    } catch (err) {
      if (token === wordToken) fill([span('wp-word', word), span('wp-tr wp-err', `⚠️ ${err.message || t('word.failed')}`)]);
      return;
    }
  }
  if (token !== wordToken) return;
  fill([
    span('wp-word', info.expanded ? `${word} (${info.expanded})` : word),
    span('wp-tr', info.tr)
  ]);
}

function applyColorSent() {
  document.body.classList.toggle('sent-off', !colorSent);
  els.colorToggle.checked = colorSent;
}

function renderLine(seg, i) {
  const line = document.createElement('div');
  line.className = 'line';

  const row = document.createElement('div');
  row.className = 'line-row';

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(seg.start);

  const text = document.createElement('span');
  text.className = 'text';
  renderEnglish(text, seg);
  // Clicking a word shows its meaning (and does not jump the video)
  text.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (!w) return;
    e.stopPropagation();
    showWordPop(w, line);
  });

  const replay = document.createElement('button');
  replay.className = 'replay-btn';
  replay.title = t('card.replay');
  replay.textContent = '🔁';
  replay.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLoop(i);
  });

  row.append(time, text, replay);
  line.appendChild(row);

  const tr = document.createElement('div');
  tr.className = 'tr';
  renderTr(tr, seg);
  line.appendChild(tr);

  line.addEventListener('click', () => seekTo(i));
  return line;
}

function filterSubs() {
  const q = lowercase(els.subSearch.value.trim());
  const items = els.subList.children;
  let shown = 0;
  current.segments.forEach((s, i) => {
    const hit = !q || [s.text, s.tr].some((x) => lowercase(x || '').includes(q));
    items[i].classList.toggle('hidden', !hit);
    if (hit) shown++;
  });
  els.subCount.textContent = q ? `${shown} / ${current.segments.length}` : tn('subs.count', current.segments.length);
}

/* ---------- Sync ---------- */
function updateActive() {
  if (!current) return;
  const now = els.video.currentTime;
  let idx = -1;
  for (let i = 0; i < current.segments.length; i++) {
    const s = current.segments[i];
    if (now >= s.start && now < s.end) { idx = i; break; }
  }
  if (idx === -1) {
    for (let i = current.segments.length - 1; i >= 0; i--) {
      if (now >= current.segments[i].start) { idx = i; break; }
    }
  }
  if (idx !== activeIndex) {
    activeIndex = idx;
    highlight(idx);
  }
}

function scrollToActive(force) {
  const el = els.subList.children[activeIndex];
  if (!el || el.classList.contains('hidden')) return;
  // Do not yank the list while the user scrolls by hand
  if (!force && Date.now() - manualScrollAt < 4000) {
    els.followBtn.classList.remove('hidden');
    return;
  }
  els.followBtn.classList.add('hidden');
  const list = els.subList;
  const top = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
  list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function highlight(idx) {
  const items = els.subList.children;
  for (let i = 0; i < items.length; i++) items[i].classList.toggle('active', i === idx);
  if (idx >= 0) scrollToActive(false);
}

function seekTo(i) {
  if (!current) return;
  const seg = current.segments[i];
  if (!seg) return;

  if (loopIndex !== -1 && loopIndex !== i) stopLoop();

  els.video.currentTime = seg.start;
  activeIndex = i;
  manualScrollAt = 0;
  highlight(i);

  // Auto-continue off: play only this card
  playUntil = isAutoMode ? null : seg.end;

  if (els.video.paused) els.video.play().catch(() => {});
}

/* ---------- Shadowing loop ---------- */
function toggleLoop(i) {
  if (loopIndex === i) {
    stopLoop();
  } else {
    stopLoop();
    loopIndex = i;
    els.video.currentTime = current.segments[i].start;
    playUntil = null;
    if (els.video.paused) els.video.play().catch(() => {});
    updateLoopUI();
  }
}

function stopLoop() {
  if (loopIndex === -1) return;
  loopIndex = -1;
  clearTimeout(loopTimer);
  loopTimer = null;
  updateLoopUI();
}

function updateLoopUI() {
  const items = els.subList.children;
  for (let i = 0; i < items.length; i++) {
    const btn = items[i].querySelector('.replay-btn');
    if (!btn) continue;
    const active = i === loopIndex;
    btn.textContent = active ? '⏹' : '🔁';
    btn.classList.toggle('active', active);
    btn.title = active ? t('card.stopReplay') : t('card.replay');
  }
}

/* ---------- Translation ---------- */
function applyShowTr() {
  document.body.classList.toggle('tr-off', !showTr);
  els.trToggle.checked = showTr;
}

function setTrBar({ text = '', button = '', onButton = null, progress = null } = {}) {
  const visible = showTr && (text || button);
  els.trBar.classList.toggle('hidden', !visible);
  els.trBarText.textContent = text;
  els.trBarBtn.textContent = button;
  els.trBarBtn.classList.toggle('hidden', !button);
  els.trBarBtn.onclick = onButton;
  els.trProgress.classList.toggle('hidden', progress === null);
  if (progress !== null) els.trProgressBar.style.width = `${Math.round(progress * 100)}%`;
}

const langLabel = (code) => {
  const known = settings.languages.find((l) => l.code === code);
  return languageName(code, known?.name || code);
};

const missingTranslations = () => (current ? current.segments.filter((s) => !s.tr).length : 0);
const languageMismatch = () => !!(current?.trLang && settings.targetLang && current.trLang !== settings.targetLang);

// Pulls the server's translations into the open list (adds new ones, removes cleared ones)
async function refreshTranslations(id) {
  const p = await fetch(`/api/project/${id}`).then((r) => r.json());
  if (!current || current.id !== id) return;
  current.trLang = p.trLang;
  const items = els.subList.children;
  p.segments.forEach((s, i) => {
    const mine = current.segments[i];
    if (!mine || ((mine.tr || '') === (s.tr || '') && JSON.stringify(mine.trParts) === JSON.stringify(s.trParts))) return;
    mine.tr = s.tr;
    mine.trParts = s.trParts;
    const el = items[i] && items[i].querySelector('.tr');
    if (el) renderTr(el, mine);
  });
}

async function checkTranslation() {
  if (!current) return;
  const id = current.id;
  const myPoll = ++trPollId;
  let state = { status: 'idle' };
  try { state = await fetch(`/api/project/${id}/translate`).then((r) => r.json()); } catch { /* idle */ }

  while (state.status === 'running' && current && current.id === id && myPoll === trPollId) {
    setTrBar({
      text: t('tr.running', { lang: langLabel(state.lang || settings.targetLang), done: state.done, total: state.total }),
      progress: state.total ? state.done / state.total : 0
    });
    await sleep(1500);
    try {
      state = await fetch(`/api/project/${id}/translate`).then((r) => r.json());
      await refreshTranslations(id);
    } catch { break; }
  }
  if (!current || current.id !== id || myPoll !== trPollId) return;
  if (state.status === 'done') await refreshTranslations(id).catch(() => {});

  const lang = settings.targetLang;
  if (state.status === 'error') {
    setTrBar({ text: t('tr.error', { msg: state.error }), button: t('tr.retry'), onButton: startTranslation });
  } else if (!lang) {
    setTrBar({ text: t('tr.needLang'), button: t('tr.chooseLang'), onButton: () => openSettings(false) });
  } else if (!settings.translator.installed) {
    if (missingTranslations()) setTrBar({ text: t('tr.noModel') });
    else setTrBar();
  } else if (languageMismatch()) {
    setTrBar({ text: t('tr.mismatch', { from: langLabel(current.trLang), to: langLabel(lang) }), button: t('tr.translateTo', { to: langLabel(lang) }), onButton: startTranslation });
  } else if (missingTranslations()) {
    setTrBar({ text: t('tr.none', { lang: langLabel(lang) }), button: t('tr.translate'), onButton: startTranslation });
  } else {
    setTrBar();
  }
}

async function startTranslation() {
  if (!current) return;
  els.trBarBtn.disabled = true;
  try {
    const r = await fetch(`/api/project/${current.id}/translate`, { method: 'POST' });
    if (!r.ok) throw new Error(apiError(await r.json().catch(() => ({}))));
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  } finally {
    els.trBarBtn.disabled = false;
  }
  checkTranslation();
}

/* ---------- Settings ---------- */
async function loadSettings() {
  try {
    settings = await fetch('/api/settings').then((r) => r.json());
  } catch { /* keep defaults */ }
}

// Browser language → a supported translation language (never English: the videos are English)
function guessTargetLang() {
  const codes = new Set(settings.languages.map((l) => l.code));
  for (const l of navigator.languages || [navigator.language || '']) {
    const base = l.split('-')[0].toLowerCase();
    if (base !== 'en' && codes.has(base)) return base;
  }
  return '';
}

function fillSettings(firstRun) {
  els.settingsIntro.classList.toggle('hidden', !firstRun);

  els.uiLangSelect.replaceChildren(...localeOptions().map((o) => new Option(o.name, o.code, false, o.code === getLang())));

  const options = settings.languages
    .map((l) => ({ code: l.code, label: langLabel(l.code) }))
    .sort((a, b) => a.label.localeCompare(b.label, getLang()));
  const selected = settings.targetLang || (firstRun ? guessTargetLang() : '');
  els.targetLangSelect.replaceChildren(
    new Option(t('settings.pick'), '', false, !selected),
    ...options.map((o) => new Option(o.label, o.code, false, o.code === selected))
  );

  els.stWhisper.textContent = settings.whisperModel ? t('settings.whisper', { name: settings.whisperModel }) : t('settings.whisperMissing');
  els.stTranslator.textContent = settings.translator.installed ? t('settings.translator') : t('settings.translatorMissing');
}

function openSettings(firstRun = false) {
  fillSettings(firstRun);
  els.settings.classList.remove('hidden');
  (firstRun ? els.targetLangSelect : els.settingsDone).focus();
}

async function saveTargetLang() {
  const code = els.targetLangSelect.value;
  if (!code || code === settings.targetLang) return;
  try {
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetLang: code }) });
    if (!r.ok) throw new Error(apiError(await r.json().catch(() => ({}))));
    settings.targetLang = code;
    wordCache.clear();
    toast(t('toast.saved'));
    if (current) { renderList(); checkTranslation(); }
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  }
}

async function closeSettings() {
  await saveTargetLang();
  els.settings.classList.add('hidden');
}

els.settingsBtn.addEventListener('click', () => openSettings(false));
els.settingsClose.addEventListener('click', closeSettings);
els.settingsDone.addEventListener('click', closeSettings);
els.settings.addEventListener('click', (e) => { if (e.target === els.settings) closeSettings(); });
els.targetLangSelect.addEventListener('change', saveTargetLang);
els.uiLangSelect.addEventListener('change', () => { setLang(els.uiLangSelect.value); location.reload(); });

/* ---------- Speed ---------- */
function renderSpeed() {
  const rate = els.video.playbackRate;
  document.querySelectorAll('.speed-seg button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.rate) === rate);
  });
}

/* ---------- New video modal & transcription ---------- */
function openModal() {
  els.modal.classList.remove('hidden');
  if (!transcribing) {
    els.progress.classList.add('hidden');
    els.urlInput.focus();
  }
}

function closeModal() {
  els.modal.classList.add('hidden');
}

function setTranscribing(on) {
  transcribing = on;
  els.goBtn.disabled = on;
  els.urlInput.disabled = on;
  els.newBtn.textContent = on ? t('nav.busy') : t('nav.new');
}

function setStage(s) { els.progressText.textContent = t(`stage.${s}`); }

async function pollJob(jobId) {
  for (;;) {
    await sleep(1200);
    const job = await fetch(`/api/job/${jobId}`).then((r) => r.json());
    setStage(job.stage);
    if (job.status === 'done') {
      closeModal();
      els.urlInput.value = '';
      toast(t('toast.ready'));
      await loadProjects();
      go(`#/v/${job.project.id}`);
      return;
    }
    if (job.status === 'error') throw new Error(apiError(job));
  }
}

async function startTranscribe() {
  if (transcribing) return;
  const url = els.urlInput.value.trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    els.urlInput.focus();
    return toast(t('toast.badUrl'));
  }
  setTranscribing(true);
  els.progress.classList.remove('hidden');
  setStage('queued');
  try {
    const r = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!r.ok) throw new Error(apiError(await r.json().catch(() => ({}))));
    const { jobId } = await r.json();
    await pollJob(jobId);
  } catch (err) {
    els.progressText.textContent = `${t('stage.error')} ${err.message}`;
    els.modal.classList.remove('hidden');
    toast(`⚠️ ${err.message}`);
  } finally {
    setTranscribing(false);
  }
}

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (confirmResolve) return closeConfirm(false);
    closeWordPop();
    closeDrawer();
    if (!els.settings.classList.contains('hidden')) return closeSettings();
    return closeModal();
  }
  const overlayOpen = confirmResolve || !els.modal.classList.contains('hidden') || !els.settings.classList.contains('hidden');
  if (overlayOpen) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
  if (els.workspace.classList.contains('hidden') || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); seekBy(5); }
  else if (e.code === 'ArrowUp') { e.preventDefault(); seekTo(Math.max(0, activeIndex - 1)); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); seekTo(activeIndex + 1); }
  else if (e.code === 'KeyV') toggleTextMode();
});

function togglePlay() {
  if (!els.video.src) return;
  if (els.video.paused) els.video.play().catch(() => {});
  else els.video.pause();
}

function seekBy(d) { els.video.currentTime = Math.max(0, els.video.currentTime + d); }

/* ---------- Video list drawer ---------- */
function openDrawer() {
  els.sidebar.classList.add('open');
  els.drawerBackdrop.classList.remove('hidden');
  els.drawerBtn.setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  els.sidebar.classList.remove('open');
  els.drawerBackdrop.classList.add('hidden');
  els.drawerBtn.setAttribute('aria-expanded', 'false');
}

/* ---------- Text-only mode (video hidden) ---------- */
function applyTextMode() {
  document.body.classList.toggle('text-mode', textMode);
  els.mpTitle.textContent = current ? titleOf(current) : '';
}
function toggleTextMode() {
  textMode = !textMode;
  store('textMode', textMode);
  applyTextMode();
  if (!els.subList.children.length) return;
  scrollToActive(true); // the layout changed: re-centre the active card
}

// While the video is hidden the audio keeps playing; the small player bar controls it
let seekDragging = false;
function updateMiniPlayer() {
  const v = els.video;
  els.mpPlay.textContent = v.paused ? '▶' : '⏸';
  els.mpTime.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration || 0)}`;
  if (!seekDragging && v.duration) els.mpSeek.value = String(Math.round((v.currentTime / v.duration) * 1000));
}

/* ---------- Wire up ---------- */
applyI18n();
document.body.classList.toggle('auto-mode-off', !isAutoMode);
els.autoModeToggle.checked = isAutoMode;
applyShowTr();
applyColorSent();
applyTextMode();

els.trToggle.addEventListener('change', (e) => {
  showTr = e.target.checked;
  store('showTr', showTr);
  applyShowTr();
  checkTranslation();
});
els.colorToggle.addEventListener('change', (e) => {
  colorSent = e.target.checked;
  store('colorSent', colorSent);
  applyColorSent();
});
els.autoModeToggle.addEventListener('change', (e) => {
  isAutoMode = e.target.checked;
  store('autoMode', isAutoMode);
  document.body.classList.toggle('auto-mode-off', !isAutoMode);
  playUntil = null;
  if (loopIndex !== -1) stopLoop();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.w, .word-pop')) closeWordPop(); });

els.video.addEventListener('timeupdate', () => {
  updateActive();
  savePos(false);

  const now = els.video.currentTime;
  if (loopIndex !== -1) {
    const seg = current.segments[loopIndex];
    if (now >= seg.end) {
      els.video.pause();
      if (!loopTimer) {
        // Shadowing: wait one second after the card, then play it again until stopped
        loopTimer = setTimeout(() => {
          loopTimer = null;
          if (loopIndex !== -1) {
            els.video.currentTime = seg.start;
            els.video.play().catch(() => {});
          }
        }, 1000);
      }
    }
  } else if (playUntil !== null && now >= playUntil) {
    els.video.pause();
    playUntil = null;
  }
});
els.video.addEventListener('pause', () => savePos(true));
els.video.addEventListener('ratechange', () => { store('rate', els.video.playbackRate); renderSpeed(); });
els.video.addEventListener('loadedmetadata', () => {
  if (!current) return;
  const pos = savedPos(current.id);
  if (pos > 5 && pos < els.video.duration - 5) {
    els.video.currentTime = pos;
    toast(t('toast.resume', { t: fmtTime(pos) }));
  }
  renderSpeed();
  updateActive();
});
['timeupdate', 'play', 'pause', 'loadedmetadata'].forEach((ev) => els.video.addEventListener(ev, updateMiniPlayer));
setInterval(updateActive, 250);

['wheel', 'touchmove'].forEach((ev) =>
  els.subList.addEventListener(ev, () => { manualScrollAt = Date.now(); }, { passive: true })
);
els.followBtn.addEventListener('click', () => { manualScrollAt = 0; scrollToActive(true); });
els.subSearch.addEventListener('input', filterSubs);
document.querySelectorAll('.speed-seg').forEach((group) => group.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-rate]');
  if (b) els.video.playbackRate = Number(b.dataset.rate);
}));

els.drawerBtn.addEventListener('click', () => (els.sidebar.classList.contains('open') ? closeDrawer() : openDrawer()));
els.drawerBackdrop.addEventListener('click', closeDrawer);
$('#drawerHome').addEventListener('click', closeDrawer);
els.hideVideoBtn.addEventListener('click', toggleTextMode);
els.mpShowVideo.addEventListener('click', toggleTextMode);
els.mpPlay.addEventListener('click', togglePlay);
els.mpSeek.addEventListener('pointerdown', () => { seekDragging = true; });
els.mpSeek.addEventListener('pointerup', () => { seekDragging = false; });
els.mpSeek.addEventListener('input', () => {
  if (els.video.duration) els.video.currentTime = (Number(els.mpSeek.value) / 1000) * els.video.duration;
});

els.deleteBtn.addEventListener('click', () => current && deleteProject(current.id, current.title));
els.newBtn.addEventListener('click', openModal);
els.emptyNewBtn.addEventListener('click', openModal);
els.modalClose.addEventListener('click', closeModal);
els.cancelBtn.addEventListener('click', closeModal);
els.goBtn.addEventListener('click', startTranscribe);
els.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startTranscribe(); });
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
els.confirmYes.addEventListener('click', () => closeConfirm(true));
els.confirmNo.addEventListener('click', () => closeConfirm(false));
els.confirm.addEventListener('click', (e) => { if (e.target === els.confirm) closeConfirm(false); });
els.searchInput.addEventListener('input', renderGrid);

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => savePos(true));

await loadSettings();
await loadProjects();
await route();
// First run: ask which language the translations should be in
if (!settings.targetLang) openSettings(true);
