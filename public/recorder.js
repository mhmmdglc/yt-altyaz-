// Records the learner's voice and has it transcribed on this computer (POST /api/speech → local Whisper).
import { api } from './util.js';

let stream = null;
let recorder = null;
let finished = null; // resolves with the recorded Blob when the recorder stops (by us, or by itself)
let autoStop = null;

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const isRecording = () => recorder?.state === 'recording';

export async function startRecording({ maxSeconds = 15, onAutoStop } = {}) {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  finished = new Promise((resolve) => {
    rec.onstop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
  });
  recorder = rec;
  rec.start();
  autoStop = setTimeout(() => onAutoStop?.(), maxSeconds * 1000);
}

// Stops (if still recording) and returns the recording, or null if nothing was started
export async function stopRecording() {
  clearTimeout(autoStop);
  if (!recorder) return null;
  if (recorder.state === 'recording') recorder.stop();
  const blob = await finished;
  recorder = null;
  finished = null;
  return blob;
}

// → { text, silent }
export async function transcribe(blob) {
  const res = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Speech failed'), { code: data.code });
  return data;
}

export { api };
