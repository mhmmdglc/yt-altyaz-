import { t, tn, getLang, setLang, applyI18n, localeOptions, languageName } from './i18n.js';
import { $, fmtTime, toast, sleep, apiError, store, api, el, providerName } from './util.js';
import { stopClip } from './clip.js';
import { loadFavorites, dueFavorites, onFavoritesChange, findVideoFav, addVideoFav, removeFav } from './fav-store.js';
import { renderFavorites, renderReview } from './favorites-view.js';
import { renderStudy } from './study.js';

const els = {
  projectList: $('#projectList'),
  projCount: $('#projCount'),
  newBtn: $('#newBtn'),
  emptyNewBtn: $('#emptyNewBtn'),
  settingsBtn: $('#settingsBtn'),
  favBtn: $('#favBtn'),
  favBadge: $('#favBadge'),
  levelSelect2: $('#levelSelect2'),
  favoritesView: $('#favoritesView'),
  reviewView: $('#reviewView'),
  studyView: $('#studyView'),
  aiStatus: $('#aiStatus'),
  aiKeyInput: $('#aiKeyInput'),
  aiKeySave: $('#aiKeySave'),
  aiKeyRemove: $('#aiKeyRemove'),
  aiTest: $('#aiTest'),
  aiModelInput: $('#aiModelInput'),
  aiWordsToggle: $('#aiWordsToggle'),
  dsStatus: $('#dsStatus'),
  dsKeyInput: $('#dsKeyInput'),
  dsKeySave: $('#dsKeySave'),
  dsKeyRemove: $('#dsKeyRemove'),
  dsTest: $('#dsTest'),
  drawerBtn: $('#drawerBtn'),
  drawerBackdrop: $('#drawerBackdrop'),
  sidebar: $('.sidebar'),
  hideVideoBtn: $('#hideVideoBtn'),
  videoFrame: $('#videoFrame'),
  videoClick: $('#videoClick'),
  capOverlay: $('#capOverlay'),
  capEn: $('#capEn'),
  capTr: $('#capTr'),
  capSeg: $('#capSeg'),
  panelBtn: $('#panelBtn'),
  fsBtn: $('#fsBtn'),
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
let lastPosSave = 0;
let manualScrollAt = 0;
let transcribing = false;
let showTr = store('showTr') !== 'false';
let colorSent = store('colorSent') !== 'false';
let textMode = store('textMode') === 'true';
const CAP_MODES = ['off', 'en', 'tr', 'both'];
let capMode = CAP_MODES.includes(store('capMode')) ? store('capMode') : 'off'; // subtitles drawn on the video
let subsHidden = store('subsHidden') === 'true'; // the subtitle list is hidden: only the video
let trPollId = 0;
let isAutoMode = store('autoMode') !== 'false';
let playUntil = null;
let loopIndex = -1;
let loopTimer = null;

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: 'numeric' });
}

const titleOf = (p) => p.title || t('home.untitled');
const lowercase = (s) => { try { return s.toLocaleLowerCase(settings.targetLang || 'en'); } catch { return s.toLowerCase(); } };

/* ---------- Resume position ---------- */
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
let leavePage = null; // cleanup of the favorites / review page

function showView(name) {
  leavePage?.();
  leavePage = null;
  const views = { empty: els.empty, home: els.home, workspace: els.workspace, favorites: els.favoritesView, review: els.reviewView, study: els.studyView };
  for (const [n, node] of Object.entries(views)) node.classList.toggle('hidden', n !== name);
  els.drawerBtn.classList.toggle('hidden', name !== 'workspace');
  els.favBtn.classList.toggle('active', name === 'favorites' || name === 'review');
  if (name === 'workspace' && current) document.title = `${titleOf(current)} — YT Altyazı`;
  if (name !== 'workspace') {
    closeDrawer();
    savePos(true);
    els.video.pause();
    document.title = `YT Altyazı — ${t(name === 'study' ? 'study.title' : name === 'favorites' || name === 'review' ? 'fav.title' : 'home.title')}`;
  }
}

const hasProject = (id) => projects.some((p) => p.id === id);
const openVideoAt = (id, at) => go(`#/v/${id}/t/${Number(at).toFixed(2)}`);

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// 🎯 Study works on one sentence; it is kept here while the study page is open
let studySource = null;

function openStudy(source) {
  studySource = source;
  go('#/study');
}

async function route() {
  const hash = location.hash;
  if (hash.startsWith('#/study')) {
    if (!studySource) return go('#/');
    await Promise.all([loadProjects(), loadFavorites()]);
    showView('study');
    const back = studySource.back === 'favorites' || !studySource.projectId
      ? { label: t('review.back'), href: '#/favorites' }
      : { label: t('study.backVideo'), href: `#/v/${studySource.projectId}/t/${Number(studySource.start || 0).toFixed(2)}` };
    leavePage = renderStudy(els.studyView, { source: studySource, back, hasProject, levels: levelList(), getLevel: currentLevel, setLevel });
    return;
  }
  if (hash.startsWith('#/favorites') || hash.startsWith('#/review')) {
    await Promise.all([loadProjects(), loadFavorites()]);
    const review = hash.startsWith('#/review');
    showView(review ? 'review' : 'favorites');
    leavePage = review ? renderReview(els.reviewView, { hasProject }) : renderFavorites(els.favoritesView, { hasProject, openVideoAt });
    return;
  }
  const m = hash.match(/^#\/v\/([\w-]+)(?:\/t\/([\d.]+))?/);
  if (m && hasProject(m[1])) return openProject(m[1], m[2] ? Number(m[2]) : null);
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

let pendingSeek = null; // a time to jump to once the video is loaded (#/v/<id>/t/<seconds>)

function jumpTo(at) {
  els.video.currentTime = at;
  manualScrollAt = 0;
  updateActive();
  scrollToActive(true);
  history.replaceState(null, '', `#/v/${current.id}`);
}

async function openProject(id, at = null) {
  if (current && current.id === id) {
    showView('workspace');
    if (at !== null) jumpTo(at);
    return;
  }
  savePos(true);
  stopLoop();
  pendingSeek = at;

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
  updateFavMarks();
  updateActive();
}

/* ---------- Sentences, words, colors ---------- */
// Same rule as the server: translator.js → splitSentences
const splitSentences = (s) => s.split(/(?<=[.?!…])\s+/).map((x) => x.trim()).filter(Boolean);
const SENT_COLORS = 3; // style.css → .sc0 … .sc2
// The sentences of a card: stored by the server as `sents` (older videos fall back to splitting at punctuation)
const sentencesOf = (seg) => (seg.sents && seg.sents.length ? seg.sents : splitSentences(seg.text));

// Splits the English text into sentences (coloured when a card has several) and clickable word spans
function renderEnglish(target, seg) {
  const sentences = sentencesOf(seg);
  const multi = sentences.length > 1;
  sentences.forEach((sentence, k) => {
    if (k) target.append(' ');
    // Every sentence is its own span (for favorites); with several sentences it also gets a colour
    const wrap = document.createElement('span');
    wrap.className = multi ? `sent s sc${k % SENT_COLORS}` : 'sent';
    wrap.dataset.k = String(k);
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
    target.appendChild(wrap);
  });
}

// Writes the translation, split into parts that share the colors of the English sentences
// The translation of each sentence of a card, or null when they do not line up (never show a wrong pairing)
function trPartsOf(seg) {
  if (!seg.tr) return null;
  const n = sentencesOf(seg).length;
  let parts = seg.trParts;
  if (!parts || parts.length !== n) {
    const guess = splitSentences(seg.tr);
    parts = guess.length === n ? guess : null;
  }
  return parts;
}

function renderTr(el, seg) {
  el.textContent = '';
  const lang = current?.trLang || settings.targetLang;
  if (lang) { el.lang = lang; el.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr'; }
  if (!seg.tr) return;
  const n = sentencesOf(seg).length;
  const parts = trPartsOf(seg);
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

  // The sentence goes along so that (with Gemini) the meaning fits this sentence
  const sentence = wEl.closest('.sent')?.textContent || '';
  const key = `${settings.targetLang}:${word.toLowerCase()}:${settings.ai?.configured && settings.ai?.wordMeanings ? sentence : ''}`;
  let info = wordCache.get(key);
  if (!info) {
    fill([span('wp-word', word), span('wp-tr wp-wait', '…')]);
    try {
      info = await api(`/api/word?w=${encodeURIComponent(word)}&s=${encodeURIComponent(sentence)}`);
      wordCache.set(key, info);
    } catch (err) {
      if (token === wordToken) fill([span('wp-word', word), span('wp-tr wp-err', `⚠️ ${err.message || t('word.failed')}`)]);
      return;
    }
  }
  if (token !== wordToken) return;
  const lemma = info.lemma && info.lemma.toLowerCase() !== word.toLowerCase() ? info.lemma : null;
  fill([
    span('wp-word', info.expanded ? `${word} (${info.expanded})` : word),
    lemma || info.pos ? span('wp-pos', [lemma, info.pos].filter(Boolean).join(' · ')) : null,
    span('wp-tr', info.tr),
    info.note ? el('div.wp-note', { text: info.note }) : null,
    info.fallback ? el('div.wp-note.muted', { text: t('word.fallback') }) : null
  ].filter(Boolean));
}

/* ---------- Card actions: ⭐ favorite, 🎯 study ---------- */

function closePickers() {
  document.querySelectorAll('.sent-pick').forEach((x) => x.remove());
}

// Cards with several sentences ask which one; a single sentence is used directly
function pickSentence(line, i, action) {
  closePickers();
  const sents = sentencesOf(current.segments[i]);
  if (sents.length === 1) return runSentenceAction(line, i, 0, action);
  const pop = el('div.sent-pick', { onclick: (e) => e.stopPropagation() }, [
    el('div.small.muted', { text: t('card.pick') }),
    ...sents.map((text, k) => el(`button.sent-pick-item.s.sc${k % SENT_COLORS}`, { onclick: () => { pop.remove(); runSentenceAction(line, i, k, action); } }, [
      action === 'fav' ? (findVideoFav(current.id, i, k) ? '★ ' : '☆ ') : '🎯 ', text
    ]))
  ]);
  line.appendChild(pop);
}

async function runSentenceAction(line, i, k, action) {
  const sents = sentencesOf(current.segments[i]);
  if (action === 'study') return openStudy(studySourceOf(i, k));
  try {
    const existing = findVideoFav(current.id, i, k);
    if (existing) {
      await removeFav(existing.id);
      toast(t('fav.removedToast'));
    } else {
      await addVideoFav(current.id, i, k);
      toast(t('fav.added'));
    }
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  }
}

// Everything Study needs about sentence k of card i of the open video
function studySourceOf(i, k) {
  const seg = current.segments[i];
  const sents = sentencesOf(seg);
  const parts = seg.trParts?.length === sents.length ? seg.trParts : null;
  return {
    text: sents[k],
    tr: parts ? parts[k] : sents.length === 1 ? seg.tr || '' : '',
    context: k > 0 ? sents[k - 1] : i > 0 ? sentencesOf(current.segments[i - 1]).at(-1) : '',
    projectId: current.id,
    title: current.title,
    start: seg.sentTimes?.[k]?.[0] ?? seg.start,
    end: seg.sentTimes?.[k]?.[1] ?? seg.end
  };
}

// "🎯" from a favorite. A sentence of the open video keeps its audio and its way back.
document.addEventListener('app:study', (e) => {
  const d = e.detail || {};
  if (!d.back && current && !els.workspace.classList.contains('hidden')) {
    for (const [i, seg] of current.segments.entries()) {
      const k = sentencesOf(seg).indexOf(d.text);
      if (k >= 0) return openStudy(studySourceOf(i, k));
    }
  }
  openStudy({ text: d.text, tr: d.tr || '', projectId: d.projectId || null, start: d.start, end: d.end, back: d.back || null });
});

// Marks saved sentences (★) in the open video
function updateFavMarks() {
  if (!current) return;
  [...els.subList.children].forEach((line, i) => {
    let any = false;
    line.querySelectorAll('.text .sent').forEach((span) => {
      const on = !!findVideoFav(current.id, i, Number(span.dataset.k));
      span.classList.toggle('fav', on);
      any ||= on;
    });
    const btn = line.querySelector('.fav-btn');
    if (btn) { btn.textContent = any ? '★' : '☆'; btn.classList.toggle('on', any); }
  });
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

  const favBtn = el('button.card-btn.fav-btn', { text: '☆', title: t('card.fav'), 'aria-label': t('card.fav'), onclick: (e) => { e.stopPropagation(); pickSentence(line, i, 'fav'); } });
  const studyBtn = el('button.card-btn.study-btn', { text: '🎯', title: t('card.study'), 'aria-label': t('card.study'), onclick: (e) => { e.stopPropagation(); pickSentence(line, i, 'study'); } });
  row.append(time, text, el('div.card-actions', {}, [favBtn, studyBtn, replay]));
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
  updateCaption();
}

/* ---------- Subtitles on the video, hidden subtitle list ---------- */
// What the overlay shows now: the sentence being spoken (and its translation) when the card has several, otherwise the card
function captionNow() {
  const seg = current?.segments[activeIndex];
  const now = els.video.currentTime;
  if (!seg || now > seg.end + 0.4) return null;
  const sents = sentencesOf(seg);
  const parts = trPartsOf(seg);
  if (sents.length > 1 && parts && seg.sentTimes?.length === sents.length) {
    let k = 0;
    seg.sentTimes.forEach(([s], j) => { if (now >= s - 0.05) k = j; });
    return { en: sents[k], tr: parts[k] };
  }
  return { en: seg.text, tr: seg.tr || '' };
}

let capKey = '';
function updateCaption() {
  const cap = capMode === 'off' ? null : captionNow();
  const en = cap && (capMode === 'en' || capMode === 'both') ? cap.en : '';
  const tr = cap && (capMode === 'tr' || capMode === 'both') ? cap.tr : '';
  const key = `${en}\u0000${tr}`;
  if (key === capKey) return;
  capKey = key;
  els.capEn.textContent = en;
  els.capTr.textContent = tr;
  els.capEn.hidden = !en;
  els.capTr.hidden = !tr;
  els.capOverlay.hidden = !en && !tr;
  const lang = current?.trLang || settings.targetLang;
  if (lang) { els.capTr.lang = lang; els.capTr.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr'; }
}

function setCapMode(mode) {
  capMode = mode;
  store('capMode', mode);
  els.capSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.cap === mode));
  capKey = '';
  updateCaption();
}

function applyPanel() {
  document.body.classList.toggle('subs-hidden', subsHidden);
  els.panelBtn.textContent = subsHidden ? t('cap.panelShow') : t('cap.panelHide');
  els.panelBtn.title = t('cap.panelTitle');
  if (!subsHidden && els.subList.children.length) scrollToActive(true);
}

function togglePanel() {
  subsHidden = !subsHidden;
  store('subsHidden', subsHidden);
  applyPanel();
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
  fillAI();
}

/* ---------- AI (Gemini) settings and level ---------- */
const levelList = () => settings.levels || ['A2', 'B1', 'B2', 'C1'];
const currentLevel = () => settings.level || 'B1';

function fillLevels() {
  els.levelSelect2.replaceChildren(...levelList().map((l) => new Option(l, l, false, l === currentLevel())));
}

function fillAI() {
  const ai = settings.ai || {};
  const gem = ai.gemini || {};
  const ds = ai.deepseek || {};
  els.aiStatus.textContent = gem.paused ? t('settings.aiPaused')
    : gem.source === 'env' ? t('settings.aiStatusEnv')
    : gem.configured ? t('settings.aiStatusSaved', { hint: gem.keyHint }) : t('settings.aiStatusNone');
  els.aiStatus.classList.toggle('ok', !!gem.configured && !gem.paused);
  els.aiKeyRemove.classList.toggle('hidden', gem.source !== 'settings');
  els.aiTest.disabled = !gem.configured;
  els.dsStatus.textContent = ds.source === 'env' ? t('settings.dsStatusEnv', { model: ds.model })
    : ds.configured ? t('settings.dsStatusSaved', { hint: ds.keyHint, model: ds.model }) : t('settings.dsStatusNone');
  els.dsStatus.classList.toggle('ok', !!ds.configured);
  els.dsKeyRemove.classList.toggle('hidden', ds.source !== 'settings');
  els.dsTest.disabled = !ds.configured;
  els.aiModelInput.value = ai.model || '';
  els.aiWordsToggle.checked = !!ai.wordMeanings;
  els.aiWordsToggle.disabled = !ai.configured;
  fillLevels();
}

async function saveSetting(patch, okMessage = t('toast.saved')) {
  try {
    await api('/api/settings', { method: 'PUT', body: patch });
    await loadSettings();
    fillAI();
    toast(okMessage);
    return true;
  } catch (err) {
    toast(`⚠️ ${err.message}`);
    return false;
  }
}

// Level changed on the Study page: no "saved" toast, the page reloads its own content
async function setLevel(level) {
  try {
    await api('/api/settings', { method: 'PUT', body: { level } });
    await loadSettings();
    fillLevels();
    return true;
  } catch (err) {
    toast(`⚠️ ${err.message}`);
    return false;
  }
}

els.levelSelect2.addEventListener('change', () => saveSetting({ level: els.levelSelect2.value }));
els.aiKeySave.addEventListener('click', async () => {
  const key = els.aiKeyInput.value.trim();
  if (!key) return els.aiKeyInput.focus();
  if (await saveSetting({ geminiApiKey: key })) { els.aiKeyInput.value = ''; wordCache.clear(); }
});
els.aiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.aiKeySave.click(); });
els.aiKeyRemove.addEventListener('click', async () => { if (await saveSetting({ geminiApiKey: '' })) wordCache.clear(); });
els.aiWordsToggle.addEventListener('change', async () => {
  if (await saveSetting({ aiWordMeanings: els.aiWordsToggle.checked })) wordCache.clear();
});
els.aiModelInput.addEventListener('change', () => saveSetting({ geminiModel: els.aiModelInput.value.trim() }));
async function testProvider(provider, button) {
  button.disabled = true;
  try {
    const r = await api('/api/ai/test', { method: 'POST', body: { provider } });
    toast(t('settings.aiTestOk', { provider: providerName(provider), model: r.model }), 3500);
    await loadSettings();
    fillAI();
  } catch (err) {
    toast(`⚠️ ${err.message}`, 5000);
  } finally {
    button.disabled = !settings.ai?.[provider]?.configured;
  }
}
els.aiTest.addEventListener('click', () => testProvider('gemini', els.aiTest));
els.dsTest.addEventListener('click', () => testProvider('deepseek', els.dsTest));
els.dsKeySave.addEventListener('click', async () => {
  const key = els.dsKeyInput.value.trim();
  if (!key) return els.dsKeyInput.focus();
  if (await saveSetting({ deepseekApiKey: key })) els.dsKeyInput.value = '';
});
els.dsKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.dsKeySave.click(); });
els.dsKeyRemove.addEventListener('click', () => saveSetting({ deepseekApiKey: '' }));
document.addEventListener('app:open-settings', () => {
  openSettings(false);
  els.aiKeyInput.focus();
});

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
    closePickers();
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
  else if (e.code === 'KeyC') setCapMode(CAP_MODES[(CAP_MODES.indexOf(capMode) + 1) % CAP_MODES.length]);
  else if (e.code === 'KeyP') togglePanel();
  // YouTube-style keys
  else if (e.code === 'KeyK') togglePlay();
  else if (e.code === 'KeyJ') seekBy(-10);
  else if (e.code === 'KeyL') seekBy(10);
  else if (e.code === 'KeyF') toggleFullscreen();
  else if (e.code === 'KeyM') els.video.muted = !els.video.muted;
  else if (e.code === 'Home') { e.preventDefault(); els.video.currentTime = 0; }
  else if (e.code === 'End') { e.preventDefault(); els.video.currentTime = Math.max(0, (els.video.duration || 0) - 0.1); }
  else if (/^(Digit|Numpad)[0-9]$/.test(e.code)) { if (els.video.duration) els.video.currentTime = els.video.duration * Number(e.code.slice(-1)) / 10; }
  else if (e.code === 'Comma' || e.code === 'Period') {
    if (e.shiftKey) setRate(e.code === 'Comma' ? -1 : 1); // < and > change the speed
    else if (els.video.paused) els.video.currentTime += e.code === 'Comma' ? -1 / 30 : 1 / 30; // frame by frame while paused
  }
});

function togglePlay() {
  if (!els.video.src) return;
  if (els.video.paused) els.video.play().catch(() => {});
  else els.video.pause();
}

function seekBy(d) { els.video.currentTime = Math.max(0, els.video.currentTime + d); }

// Steps through the speed buttons (0.75× … 1.5×)
function setRate(step) {
  const rates = [...document.querySelectorAll('.speed-seg button[data-rate]')].map((b) => Number(b.dataset.rate));
  const i = rates.findIndex((r) => r === els.video.playbackRate);
  const next = rates[Math.min(rates.length - 1, Math.max(0, (i < 0 ? rates.indexOf(1) : i) + step))];
  if (next) els.video.playbackRate = next;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else els.videoFrame.requestFullscreen?.().catch(() => {});
}

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
setCapMode(capMode);
applyPanel();

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
document.addEventListener('click', (e) => {
  if (!e.target.closest('.w, .word-pop')) closeWordPop();
  if (!e.target.closest('.sent-pick, .card-btn')) closePickers();
});

// The main video and the clip player (favorites, library examples) never play at the same time
document.addEventListener('clip:start', () => { stopLoop(); els.video.pause(); });
els.video.addEventListener('play', () => stopClip());

// ⭐ badge: how many saved sentences are due for review
onFavoritesChange(() => {
  const due = dueFavorites().length;
  els.favBadge.textContent = String(due);
  els.favBadge.classList.toggle('hidden', !due);
  updateFavMarks();
});

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
  if (pendingSeek !== null) {
    jumpTo(pendingSeek);
    pendingSeek = null;
  } else if (pos > 5 && pos < els.video.duration - 5) {
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
els.capSeg.addEventListener('click', (e) => { const b = e.target.closest('button[data-cap]'); if (b) setCapMode(b.dataset.cap); });
els.panelBtn.addEventListener('click', togglePanel);
// Our own fullscreen button: the browser's would show only the <video> and lose the subtitles
els.fsBtn.addEventListener('click', toggleFullscreen);
// Like YouTube: click the picture to pause / play, double-click for fullscreen (the two clicks cancel each other out)
els.videoClick.addEventListener('click', togglePlay);
els.videoClick.addEventListener('dblclick', toggleFullscreen);
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
fillLevels();
await loadFavorites();
await loadProjects();
await route();
// First run: ask which language the translations should be in
if (!settings.targetLang) openSettings(true);
