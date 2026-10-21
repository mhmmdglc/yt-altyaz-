// Plays one sentence of a video (by time range), optionally in a shadowing loop, and reads text aloud.
// Used outside the video view: favorites, review and library examples.
import { sleep } from './util.js';

const audio = new Audio();
audio.preload = 'auto';
let token = 0;
let current = null; // { key, loop, onEnd }

function waitFor(event) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('media error')); };
    const cleanup = () => { audio.removeEventListener(event, ok); audio.removeEventListener('error', bad); };
    audio.addEventListener(event, ok, { once: true });
    audio.addEventListener('error', bad, { once: true });
  });
}

export function stopClip() {
  token++;
  audio.pause();
  speechSynthesis?.cancel();
  const done = current;
  current = null;
  done?.onEnd?.();
}

export const playingKey = () => current?.key ?? null;

// Plays [start, end] of a project's video. With loop: waits one second and plays again until stopped.
export async function playClip({ key, projectId, start, end, loop = false, onEnd }) {
  stopClip();
  const my = ++token;
  current = { key, loop, onEnd };
  document.dispatchEvent(new CustomEvent('clip:start')); // lets the main video pause
  const src = `/api/project/${projectId}/video`;
  try {
    if (!audio.src.endsWith(src)) {
      audio.src = src;
      await waitFor('loadedmetadata');
    }
    while (my === token) {
      audio.currentTime = start;
      await audio.play();
      await new Promise((resolve) => {
        const tick = () => {
          if (my !== token || audio.currentTime >= end || audio.ended) { audio.removeEventListener('timeupdate', tick); resolve(); }
        };
        audio.addEventListener('timeupdate', tick);
      });
      if (my !== token) return;
      audio.pause();
      if (!loop) break;
      await sleep(1000);
    }
  } catch { /* stopped or not playable */ }
  if (my === token) { const done = current; current = null; done?.onEnd?.(); }
}

// Reads English text aloud with the browser's own speech (offline on most systems)
// With loop: waits one second after each reading and reads again until stopped (shadowing).
export function speak(text, { key, onEnd, loop = false, rate = 0.95 } = {}) {
  stopClip();
  if (!('speechSynthesis' in window)) return;
  const my = ++token;
  current = { key, onEnd };
  const once = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang === 'en-US' && v.localService) || voices.find((v) => v.lang.startsWith('en'));
    if (voice) u.voice = voice;
    u.onend = async () => {
      if (my !== token) return;
      if (loop) { await sleep(1000); if (my === token) once(); return; }
      current = null;
      onEnd?.();
    };
    speechSynthesis.speak(u);
  };
  once();
}
