// The ⭐ Favorites page and the 🧠 Review (spaced repetition) page.
import { t, tn, getLang } from './i18n.js';
import { el, fmtTime, toast } from './util.js';
import { playClip, speak, stopClip, playingKey } from './clip.js';
import { getFavorites, dueFavorites, removeFav, reviewFav, onFavoritesChange } from './fav-store.js';
import { schedule, GRADES } from './srs.js';
import { openVary, closeVary } from './vary.js';

const lower = (s) => String(s || '').toLocaleLowerCase();

// "in 10 min" / "3 gün sonra": localized by the browser
export function relativeTime(ms) {
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto', style: 'short' });
  const minutes = Math.round(ms / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(Math.max(1, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

function sourceLabel(item) {
  return item.kind === 'video' ? `${item.title} · ${fmtTime(item.start)}` : t('fav.example', { pattern: item.pattern || '—' });
}

// ▶ listen (the original audio, or speech for examples) and 🔁 loop buttons for one favorite
function listenButtons(item, { hasProject, loop = true }) {
  const key = `fav:${item.id}`;
  const canPlay = item.kind === 'video' && hasProject(item.projectId);
  const play = (withLoop, btn, icon) => {
    if (playingKey() === key + withLoop) return stopClip();
    btn.textContent = '⏹';
    const onEnd = () => { btn.textContent = icon; };
    if (canPlay) playClip({ key: key + withLoop, projectId: item.projectId, start: item.start, end: item.end, loop: withLoop, onEnd });
    else speak(item.text, { key: key + withLoop, onEnd });
  };
  const playBtn = el('button.icon-btn', { text: '▶', title: t('fav.play'), 'aria-label': t('fav.play'), onclick: () => play(false, playBtn, '▶') });
  const loopBtn = loop && canPlay ? el('button.icon-btn', { text: '🔁', title: t('fav.loop'), 'aria-label': t('fav.loop'), onclick: () => play(true, loopBtn, '🔁') }) : null;
  return { playBtn, loopBtn, autoplay: () => play(false, playBtn, '▶') };
}

/* ---------- Favorites page ---------- */

export function renderFavorites(root, { hasProject, openVideoAt }) {
  let query = '';
  const list = el('ul.fav-list');
  const stats = el('p.muted');
  const reviewBtn = el('a.btn.btn-primary', { href: '#/review' });
  const search = el('input.input.search', { type: 'search', placeholder: t('fav.search'), spellcheck: 'false', oninput: (e) => { query = lower(e.target.value.trim()); draw(); } });

  root.replaceChildren(
    el('div.home-head', {}, [
      el('div', {}, [el('h1', { text: t('fav.title') }), stats]),
      el('div.fav-tools', {}, [
        reviewBtn,
        el('a.btn', { href: '/api/favorites/export.tsv', download: 'yt-altyazi-favorites.tsv', text: t('fav.export'), title: t('fav.exportTitle') }),
        search
      ])
    ]),
    list
  );

  function item(x) {
    const li = el('li.fav-item');
    const { playBtn, loopBtn } = listenButtons(x, { hasProject });
    const missing = x.kind === 'video' && !hasProject(x.projectId);
    li.append(
      el('div.fav-en', { text: x.text }),
      x.tr ? el('div.fav-tr', { text: x.tr }) : null,
      el('div.fav-meta', {}, [
        el('span', { text: sourceLabel(x) }),
        missing ? el('span.fav-missing', { text: t('fav.missingVideo') }) : null
      ]),
      el('div.fav-actions', {}, [
        playBtn, loopBtn,
        el('button.btn.btn-sm', { text: '✨ ' + t('card.varyShort'), title: t('card.vary'), onclick: () => openVary(li, { text: x.text }) }),
        x.kind === 'video' && !missing ? el('button.btn.btn-sm', { text: t('fav.open'), onclick: () => openVideoAt(x.projectId, x.start) }) : null,
        el('button.icon-btn.danger', { text: '🗑', title: t('fav.remove'), 'aria-label': t('fav.remove'), onclick: async () => {
          stopClip();
          await removeFav(x.id).catch((err) => toast(`⚠️ ${err.message}`));
        } })
      ])
    );
    return li;
  }

  function draw() {
    const all = getFavorites();
    const due = dueFavorites().length;
    stats.textContent = `${tn('fav.count', all.length)} · ${t('fav.due', { n: due })}`;
    reviewBtn.textContent = t('fav.review', { n: due });
    reviewBtn.classList.toggle('disabled', !all.length);
    const shown = query ? all.filter((x) => lower(`${x.text} ${x.tr}`).includes(query)) : all;
    if (!all.length) return list.replaceChildren(el('li.fav-empty.muted', { text: t('fav.empty') }));
    list.replaceChildren(...shown.map(item));
  }

  closeVary();
  draw();
  return onFavoritesChange(draw); // the caller unsubscribes when leaving the page
}

/* ---------- Review page ---------- */

export function renderReview(root, { hasProject }) {
  const queue = dueFavorites().sort((a, b) => (a.review?.due ?? 0) - (b.review?.due ?? 0));
  const total = queue.length;
  let done = 0;
  let revealed = false;
  let current = null;

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); if (current && !revealed) reveal(); else current && autoplay?.(); }
    const n = Number(e.key);
    if (revealed && n >= 1 && n <= 4) grade(GRADES[n - 1]);
  };
  document.addEventListener('keydown', onKey);
  let autoplay = null;

  const head = el('div.review-head', {}, [el('a.btn.btn-ghost', { href: '#/favorites', text: t('review.back') }), el('span.muted.review-progress')]);
  const card = el('div.review-card');
  root.replaceChildren(el('div.review', {}, [head, card]));

  function next() {
    stopClip();
    revealed = false;
    current = queue.shift() || null;
    head.querySelector('.review-progress').textContent = t('review.progress', { done, total });
    if (!current) return finish();
    const { playBtn, loopBtn, autoplay: ap } = listenButtons(current, { hasProject });
    autoplay = ap;
    card.replaceChildren(
      el('p.muted.small', { text: t('review.hint') }),
      el('div.review-en', { text: current.text }),
      el('div.review-listen', {}, [playBtn, loopBtn]),
      el('div.review-back'),
      el('button.btn.btn-primary.btn-lg.review-show', { text: t('review.show'), onclick: reveal })
    );
    ap();
  }

  function reveal() {
    revealed = true;
    const now = Date.now();
    card.querySelector('.review-show')?.remove();
    card.querySelector('.review-back').replaceChildren(
      el('div.review-tr', { text: current.tr || '—' }),
      el('div.fav-meta', { text: sourceLabel(current) }),
      el('div.review-grades', {}, GRADES.map((g, i) => el(`button.btn.grade-${g}`, { onclick: () => grade(g) }, [
        el('strong', { text: t(`review.${g}`) }),
        el('span.small', { text: `${i + 1} · ${relativeTime(schedule(current.review, g, now).due - now)}` })
      ])))
    );
  }

  async function grade(g) {
    if (!current) return;
    const item = current;
    current = null;
    try {
      const updated = await reviewFav(item.id, g);
      if (g === 'again') queue.push(updated); else done++;
    } catch (err) {
      toast(`⚠️ ${err.message}`);
    }
    next();
  }

  function finish() {
    const upcoming = getFavorites().map((x) => x.review?.due ?? 0).filter((d) => d > Date.now()).sort((a, b) => a - b)[0];
    card.replaceChildren(
      el('h2', { text: total ? t('review.doneTitle') : t('review.nothing') }),
      upcoming ? el('p.muted', { text: t('review.doneText', { when: relativeTime(upcoming - Date.now()) }) }) : null,
      el('a.btn', { href: '#/favorites', text: t('review.back') })
    );
  }

  next();
  return () => { document.removeEventListener('keydown', onKey); stopClip(); };
}
