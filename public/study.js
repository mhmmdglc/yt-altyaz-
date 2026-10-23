// 🎯 Study: a speaking ladder built from one sentence. The learner sees the sentence in their language,
// says it in English (transcribed locally by Whisper and checked word by word), then reveals and listens.
import { t } from './i18n.js';
import { api, el, toast, highlightPattern, stripMarks, setChildren, providerName } from './util.js';
import { mountVary } from './vary.js';
import { playClip, speak, stopClip, playingKey } from './clip.js';
import { compareSpeech } from './speech-match.js';
import { canRecord, startRecording, stopRecording, isRecording, transcribe } from './recorder.js';
import { addExampleFav } from './fav-store.js';

/* ---------- 🎤 Say it: record, transcribe locally, compare ---------- */

let activeSay = null; // the button that is recording right now

// A "🎤 Say it" button with its result line. onResult(result) is called with compareSpeech's result.
export function sayWidget({ expected, alternatives = [], onResult }) {
  const result = el('div.say-result');
  const button = el('button.btn.btn-sm.say-btn', { text: t('study.say'), onclick: (e) => { e.stopPropagation(); toggle(); } });

  async function toggle() {
    if (button.disabled) return;
    if (activeSay === api) return api.stop(true); // our recording (even if the microphone already stopped by itself)
    if (activeSay) await activeSay.stop(false);
    if (!canRecord()) return show(el('span.say-bad', { text: t('study.noMic') }));
    try {
      stopClip();
      await startRecording({ onAutoStop: () => api.stop(true) });
      activeSay = api;
      button.textContent = t('study.stop');
      button.classList.add('recording');
      show(el('span.muted', { text: t('study.listening') }));
    } catch {
      show(el('span.say-bad', { text: t('study.noMic') }));
    }
  }

  function show(...nodes) { setChildren(result, ...nodes); }

  const api = {
    button,
    result,
    toggle,
    async stop(check) {
      const blob = await stopRecording();
      activeSay = null;
      button.textContent = t('study.say');
      button.classList.remove('recording');
      if (!check || !blob) return show();
      button.disabled = true;
      show(el('span.muted', { text: t('study.checking') }));
      try {
        const { text, silent } = await transcribe(blob);
        if (silent) return show(el('span.say-bad', { text: t('study.silent') }));
        const r = compareSpeech(text, expected, alternatives);
        const missing = r.words.filter((w) => !w.ok).map((w) => w.word);
        show(
          el('div.say-heard', { text: t('study.heard', { text }) }),
          el(`div.say-verdict.v-${r.verdict}`, {
            text: r.verdict === 'good' ? t('study.good')
              : r.verdict === 'close' ? (missing.length ? t('study.close', { words: missing.join(', ') }) : t('study.closeExtra'))
              : t('study.wrong')
          })
        );
        onResult?.(r);
      } catch (err) {
        show(el('span.say-bad', { text: `⚠️ ${err.message}` }));
      } finally {
        button.disabled = false;
      }
    }
  };
  return api;
}

/* ---------- The Study page ---------- */

// source: { text, tr, context, projectId?, start?, end?, title? }; back: { label, href }
export function renderStudy(root, { source, back, hasProject, levels, getLevel, setLevel }) {
  let data = null;
  let tab = 'speak'; // 'speak' | 'vary'
  let varyMounted = false;
  let mode = localStorage.getItem('studyMode') === 'single' ? 'single' : 'list';
  let index = 0;
  let focus = null; // a Set of step indices when practising only the missed ones
  const state = []; // per step: { revealed, hint, grade: 'known' | 'missed' | null, say }

  const listenOriginal = () => {
    const key = 'study:source';
    if (playingKey() === key) return stopClip();
    if (source.projectId && hasProject(source.projectId) && source.end > source.start) {
      playClip({ key, projectId: source.projectId, start: source.start, end: source.end });
    } else {
      speak(source.text, { key });
    }
  };

  const head = el('div.study-head', {}, [
    el('a.btn.btn-ghost', { href: back.href, text: back.label }),
    el('div.study-source', {}, [
      el('div.study-source-en', { text: source.text }),
      source.tr ? el('div.study-source-tr', { text: source.tr }) : null
    ]),
    el('button.icon-btn', { text: '▶', title: t('fav.play'), 'aria-label': t('fav.play'), onclick: listenOriginal })
  ]);
  const info = el('div.study-info');
  const tabs = el('div.study-tabs');
  const tools = el('div.study-tools');
  const body = el('div.study-body', {}, [el('p.muted', { text: t('study.loading') })]);
  const summary = el('div.study-summary');
  const speakPane = el('div.study-pane', {}, [tools, body, summary, el('p.muted.small.study-privacy', { text: t('study.privacy') })]);
  const varyBody = el('div.vary-body');
  const varyPane = el('div.study-pane.hidden', {}, [varyBody]);
  root.replaceChildren(el('div.study', {}, [head, info, tabs, speakPane, varyPane]));

  function drawTabs() {
    const tabBtn = (id, label) => el(`button${tab === id ? '.active' : ''}`, { text: label, onclick: () => showTab(id) });
    const levelSel = el('select.select.select-sm', { title: t('study.levelTitle'), onchange: async (e) => {
      const ok = await setLevel(e.target.value);
      if (!ok) { e.target.value = getLevel(); return; }
      stopClip();
      varyMounted = false;
      load();
      if (tab === 'vary') showTab('vary');
    } }, levels.map((l) => new Option(l, l, false, l === getLevel())));
    setChildren(tabs,
      el('div.seg', { role: 'group' }, [tabBtn('speak', t('study.tabSpeak')), tabBtn('vary', t('study.tabVary'))]),
      el('span.head-spacer'),
      el('label.level-pick', { title: t('study.levelTitle') }, [el('span', { text: t('settings.level') }), levelSel])
    );
  }

  function showTab(id) {
    tab = id;
    if (id !== 'speak') stopClip();
    speakPane.classList.toggle('hidden', id !== 'speak');
    varyPane.classList.toggle('hidden', id !== 'vary');
    if (id === 'vary' && !varyMounted) {
      varyMounted = true;
      mountVary(varyBody, { text: source.text, context: source.context || '' });
    }
    drawTabs();
  }

  async function load(fresh = false) {
    body.replaceChildren(el('p.muted', { text: t('study.loading') }));
    summary.replaceChildren();
    info.replaceChildren();
    try {
      data = await api('/api/ai/drill', { method: 'POST', body: { text: source.text, context: source.context || '', fresh } });
    } catch (err) {
      setChildren(body,
        el('p.vary-error', { text: `⚠️ ${err.code === 'NO_AI_KEY' ? t('vary.needKey') : err.message}` }),
        ['NO_AI_KEY', 'AI_KEY_INVALID', 'AI_MODEL', 'NO_LANG'].includes(err.code)
          ? el('button.btn.btn-sm', { text: t('vary.openSettings'), onclick: () => document.dispatchEvent(new CustomEvent('app:open-settings')) }) : null
      );
      return;
    }
    state.length = 0;
    data.steps.forEach(() => state.push({ revealed: false, hint: false, grade: null }));
    index = 0;
    focus = null;
    info.replaceChildren(
      el('div.vary-pattern', {}, [
        el('span.vary-label', { text: t('vary.title') }), el('strong', { text: data.pattern }),
        data.provider ? el('span.provider-chip', { text: providerName(data.provider), title: t('ai.madeBy', { provider: providerName(data.provider) }) }) : null
      ]),
      el('p.vary-explain', { text: data.explanation })
    );
    drawTools();
    draw();
  }

  function drawTools() {
    const modeBtn = (m, label) => el(`button${mode === m ? '.active' : ''}`, { text: label, onclick: () => { mode = m; localStorage.setItem('studyMode', m); drawTools(); draw(); } });
    setChildren(tools,
      el('div.seg', { role: 'group' }, [modeBtn('list', t('study.list')), modeBtn('single', t('study.single'))]),
      el('button.btn.btn-sm', { text: t('study.fresh'), onclick: () => { stopClip(); load(true); } }),
      mode === 'single' ? el('span.muted.small', { text: t('study.keys') }) : null
    );
  }

  const visibleSteps = () => data.steps.map((s, i) => i).filter((i) => !focus || focus.has(i));

  function stepView(i) {
    const step = data.steps[i];
    const st = state[i];
    const plain = stripMarks(step.en);
    const box = el(`div.step${st.grade ? `.g-${st.grade}` : ''}`);
    const en = el(`div.step-en${st.revealed ? '' : '.blur'}`, { title: st.revealed ? '' : t('study.revealHint'), onclick: () => reveal(i) }, highlightPattern(step.en));
    const listenKey = `step:${i}`;
    const listen = el('button.icon-btn', { text: '🔊', title: t('study.listen'), 'aria-label': t('study.listen'), onclick: () => {
      if (playingKey() === listenKey) return stopClip();
      reveal(i);
      speak(plain, { key: listenKey });
    } });
    const loop = el('button.icon-btn', { text: '🔁', title: t('study.loop'), 'aria-label': t('study.loop'), onclick: () => {
      if (playingKey() === listenKey + ':loop') return stopClip();
      reveal(i);
      speak(plain, { key: listenKey + ':loop', loop: true });
    } });
    st.say = sayWidget({
      expected: plain,
      alternatives: step.alternatives,
      onResult: (r) => {
        reveal(i);
        if (r.verdict === 'good') grade(i, 'known');
        else if (r.verdict === 'wrong') grade(i, 'missed');
      }
    });
    const gradeBtn = (g, label) => el(`button.btn.btn-sm.grade-btn${st.grade === g ? '.on' : ''}`, { text: label, onclick: () => grade(i, st.grade === g ? null : g) });
    setChildren(box,
      el('div.step-head', {}, [el('span.chip', { text: step.label }), el('span.muted.small', { text: `${i + 1} / ${data.steps.length}` })]),
      el('div.step-native', { text: step.native }),
      en,
      st.hint && !st.revealed ? el('div.step-hint', { text: `💡 ${step.hint}` }) : null,
      el('div.step-actions', {}, [
        st.say.button,
        !st.revealed && step.hint && !st.hint ? el('button.btn.btn-sm', { text: t('study.hint'), onclick: () => { st.hint = true; redraw(i); } }) : null,
        !st.revealed ? el('button.btn.btn-sm', { text: t('study.reveal'), onclick: () => reveal(i) }) : null,
        listen, loop,
        el('span.head-spacer'),
        gradeBtn('known', t('study.known')),
        gradeBtn('missed', t('study.missed'))
      ]),
      st.say.result
    );
    box.dataset.i = String(i);
    return box;
  }

  function redraw(i) {
    const old = body.querySelector(`.step[data-i="${i}"]`);
    if (old) old.replaceWith(stepView(i));
    drawSummary();
  }

  function reveal(i) {
    if (state[i].revealed) return;
    state[i].revealed = true;
    const enBox = body.querySelector(`.step[data-i="${i}"] .step-en`);
    if (enBox) { enBox.classList.remove('blur'); enBox.title = ''; }
    body.querySelector(`.step[data-i="${i}"] .step-hint`)?.remove();
    body.querySelectorAll(`.step[data-i="${i}"] .step-actions .btn`).forEach((b) => {
      if ([t('study.reveal'), t('study.hint')].includes(b.textContent)) b.remove();
    });
  }

  function grade(i, g) {
    state[i].grade = g;
    const box = body.querySelector(`.step[data-i="${i}"]`);
    if (box) {
      box.classList.toggle('g-known', g === 'known');
      box.classList.toggle('g-missed', g === 'missed');
      box.querySelectorAll('.grade-btn').forEach((b) => b.classList.toggle('on', b.textContent === (g === 'known' ? t('study.known') : g === 'missed' ? t('study.missed') : '')));
    }
    drawSummary();
  }

  function draw() {
    stopClip();
    const steps = visibleSteps();
    if (mode === 'list') {
      body.replaceChildren(...steps.map(stepView));
    } else {
      index = Math.min(index, steps.length - 1);
      const i = steps[index];
      body.replaceChildren(
        el('div.single-nav', {}, [
          el('button.btn.btn-sm', { text: '←', disabled: index === 0, onclick: () => move(-1) }),
          el('span.muted', { text: t('study.progress', { n: index + 1, total: steps.length }) }),
          el('button.btn.btn-sm', { text: '→', disabled: index >= steps.length - 1, onclick: () => move(1) })
        ]),
        stepView(i)
      );
    }
    drawSummary();
  }

  function move(d) {
    const steps = visibleSteps();
    index = Math.max(0, Math.min(steps.length - 1, index + d));
    draw();
  }

  function drawSummary() {
    if (!data) return;
    const known = state.filter((s) => s.grade === 'known').length;
    const missed = state.map((s, i) => (s.grade === 'missed' ? i : -1)).filter((i) => i >= 0);
    const left = state.length - known - missed.length;
    setChildren(summary,
      el('strong', { text: t('study.summary', { known, missed: missed.length, left }) }),
      missed.length ? el('button.btn.btn-sm', { text: t('study.addMissed', { n: missed.length }), onclick: async (e) => {
        e.target.disabled = true;
        try {
          for (const i of missed) {
            const s = data.steps[i];
            await addExampleFav({ kind: 'drill', text: stripMarks(s.en), tr: s.native, pattern: data.pattern, source: source.text });
          }
          toast(t('study.addedMissed'));
        } catch (err) { toast(`⚠️ ${err.message}`); e.target.disabled = false; }
      } }) : null,
      missed.length && !focus ? el('button.btn.btn-sm', { text: t('study.retryMissed'), onclick: () => {
        focus = new Set(missed);
        missed.forEach((i) => Object.assign(state[i], { revealed: false, hint: false, grade: null }));
        index = 0;
        draw();
      } }) : null,
      focus ? el('button.btn.btn-sm', { text: t('study.showAll'), onclick: () => { focus = null; index = 0; draw(); } }) : null
    );
  }

  // One-by-one mode keys: M speak · Space show · 1 knew · 2 didn't · ← → move
  const onKey = (e) => {
    if (tab !== 'speak' || mode !== 'single' || !data || e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = visibleSteps()[index];
    if (i === undefined) return;
    if (e.code === 'KeyM') { e.preventDefault(); state[i].say?.toggle(); }
    else if (e.code === 'Space') { e.preventDefault(); reveal(i); }
    else if (e.key === '1') grade(i, 'known');
    else if (e.key === '2') grade(i, 'missed');
    else if (e.code === 'ArrowRight') move(1);
    else if (e.code === 'ArrowLeft') move(-1);
    else if (e.code === 'KeyL') { reveal(i); speak(stripMarks(data.steps[i].en), { key: `step:${i}` }); }
  };
  document.addEventListener('keydown', onKey);

  drawTabs();
  load();
  return async () => {
    document.removeEventListener('keydown', onKey);
    if (isRecording()) await stopRecording();
    stopClip();
  };
}

