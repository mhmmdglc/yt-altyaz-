// "✨ Vary": the grammar pattern of a sentence, new example sentences in the same pattern, and real examples from your videos.
import { t } from './i18n.js';
import { api, el, toast, highlightPattern, stripMarks, setChildren } from './util.js';
import { playClip, speak, stopClip, playingKey } from './clip.js';
import { addExampleFav, addVideoFav, findExampleFav, findVideoFav } from './fav-store.js';

let open = null; // { panel, token }

export function closeVary() {
  if (!open) return;
  open.panel.remove();
  open = null;
}

const openSettings = () => document.dispatchEvent(new CustomEvent('app:open-settings', { detail: { section: 'ai' } }));

// Renders the panel at the end of `container` (a card or a favorite) for one English sentence.
export async function openVary(container, { text, context = '' }) {
  closeVary();
  const panel = el('div.vary-panel', { onclick: (e) => e.stopPropagation() });
  const state = { token: Symbol('vary') };
  open = { panel, token: state.token };
  container.appendChild(panel);
  const header = el('div.vary-head', {}, [
    el('span.vary-source', { text: `“${text}”` }),
    el('button.btn.btn-sm.btn-ghost.vary-x', { text: '×', title: t('common.close'), 'aria-label': t('common.close'), onclick: closeVary })
  ]);
  const body = el('div.vary-body', {}, [el('p.muted.vary-wait', { text: t('vary.loading') })]);
  panel.append(header, body);
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const load = async (more = false) => {
    try {
      return await api('/api/ai/vary', { method: 'POST', body: { text, context, more } });
    } catch (err) {
      if (open?.token !== state.token) return null;
      setChildren(body,
        el('p.vary-error', { text: `⚠️ ${err.code === 'NO_AI_KEY' ? t('vary.needKey') : err.message}` }),
        ['NO_AI_KEY', 'AI_KEY_INVALID', 'AI_MODEL', 'NO_LANG'].includes(err.code)
          ? el('button.btn.btn-sm', { text: t('vary.openSettings'), onclick: openSettings }) : null
      );
      return null;
    }
  };

  const data = await load();
  if (!data || open?.token !== state.token) return;
  render(body, data);

  function render(target, d) {
    const examples = el('ol.vary-examples', {}, d.examples.map((ex) => exampleItem(ex, d.pattern, text)));
    const moreBtn = el('button.btn.btn-sm', { text: t('vary.more'), onclick: async () => {
      moreBtn.disabled = true;
      moreBtn.textContent = t('vary.loading');
      const next = await load(true);
      if (next && open?.token === state.token) render(target, next);
    } });
    target.replaceChildren(
      el('div.vary-pattern', {}, [el('span.vary-label', { text: t('vary.title') }), el('strong', { text: d.pattern }), el('span.badge', { text: d.level })]),
      el('p.vary-explain', { text: d.explanation }),
      examples,
      el('div.vary-actions', {}, [
        moreBtn,
        el('button.btn.btn-sm.btn-primary', { text: t('study.fromVary'), onclick: () => document.dispatchEvent(new CustomEvent('app:study', { detail: { text } })) }),
        el('span.muted.small', { text: t('vary.aiNote') })
      ]),
      libraryBlock(d.library || [])
    );
  }
}

function exampleItem(ex, pattern, source) {
  const plain = stripMarks(ex.en);
  const key = `tts:${plain}`;
  const speakBtn = el('button.icon-btn', { text: '🔊', title: t('vary.speak'), 'aria-label': t('vary.speak'), onclick: () => {
    if (playingKey() === key) return stopClip();
    speak(plain, { key });
  } });
  const saved = !!findExampleFav(plain);
  const starBtn = el('button.icon-btn', { text: saved ? '★' : '☆', title: t('vary.saveExample'), 'aria-label': t('vary.saveExample'), disabled: saved, onclick: async () => {
    try {
      await addExampleFav({ text: plain, tr: ex.tr, pattern, source });
      starBtn.textContent = '★';
      starBtn.disabled = true;
      toast(t('fav.added'));
    } catch (err) { toast(`⚠️ ${err.message}`); }
  } });
  return el('li', {}, [
    el('div.vary-en', {}, highlightPattern(ex.en)),
    el('div.vary-tr', { text: ex.tr }),
    el('div.vary-item-actions', {}, [speakBtn, starBtn])
  ]);
}

function libraryBlock(hits) {
  const title = el('div.vary-label', { text: t('vary.library') });
  if (!hits.length) return el('div.vary-library', {}, [title, el('p.muted.small', { text: t('vary.noLibrary') })]);
  return el('div.vary-library', {}, [title, el('ul', {}, hits.map((h) => {
    const key = `lib:${h.projectId}:${h.cardIndex}:${h.sentIndex}`;
    const playBtn = el('button.icon-btn', { text: '▶', title: t('vary.play'), 'aria-label': t('vary.play'), onclick: () => {
      if (playingKey() === key) return stopClip();
      playBtn.textContent = '⏹';
      playClip({ key, projectId: h.projectId, start: h.start, end: h.end, onEnd: () => { playBtn.textContent = '▶'; } });
    } });
    const saved = !!findVideoFav(h.projectId, h.cardIndex, h.sentIndex);
    const starBtn = el('button.icon-btn', { text: saved ? '★' : '☆', title: t('card.fav'), 'aria-label': t('card.fav'), disabled: saved, onclick: async () => {
      try {
        await addVideoFav(h.projectId, h.cardIndex, h.sentIndex);
        starBtn.textContent = '★';
        starBtn.disabled = true;
        toast(t('fav.added'));
      } catch (err) { toast(`⚠️ ${err.message}`); }
    } });
    return el('li', {}, [
      el('div.vary-en', { text: h.text }),
      h.tr ? el('div.vary-tr', { text: h.tr }) : null,
      el('div.vary-item-actions', {}, [playBtn, starBtn, el('span.muted.small', { text: h.title })])
    ]);
  }))]);
}
