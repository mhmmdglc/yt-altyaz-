// Extracts a word-level transcript and a silence map from a video (ffmpeg + whisper.cpp).
import { readFile, unlink } from 'node:fs/promises';
import { run } from './exec.js';
import { bin, findWhisperModel } from './config.js';
import { detectSilences, wordsFromWhisper } from './segmenter.js';

// workBase: temp-file prefix (workBase.wav, workBase.json; removed when done)
// onStage: reports 'extract' | 'transcribe' | 'segment'
export async function analyzeAudio(videoPath, workBase, onStage = () => {}) {
  const model = findWhisperModel();
  if (!model) throw new Error('No Whisper model found. Run: npm run setup');
  const wav = `${workBase}.wav`;
  const json = `${workBase}.json`;
  try {
    onStage('extract');
    await run(bin.ffmpeg, ['-y', '-i', videoPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);

    onStage('transcribe');
    // -ml 1 -sow: one word per segment (a timestamp for every word)
    // -mc 0: do not condition on previous text. When enabled, Whisper drifts into lower-case text without punctuation on some
    //        recordings (measured: 12 sentence ends in 2807 words vs 253 with -mc 0), and sentence boundaries come from punctuation.
    await run(bin.whisper, ['-m', model, '-f', wav, '-oj', '-of', workBase, '-l', 'en', '-ml', '1', '-sow', '-mc', '0', '-np']);
    const words = wordsFromWhisper(JSON.parse(await readFile(json, 'utf8')));

    onStage('segment');
    const silences = await detectSilences(wav);
    return { words, silences };
  } finally {
    await unlink(wav).catch(() => {});
    await unlink(json).catch(() => {});
  }
}

// Transcribes a short recording of the learner speaking (🎯 Study). Runs locally; nothing is uploaded.
// Returns { text, silent }: silent recordings are detected first, because Whisper invents words for silence.
export async function transcribeSpeech(inputFile, workBase) {
  const model = findWhisperModel();
  if (!model) throw Object.assign(new Error('No Whisper model found. Run: npm run setup'), { code: 'NO_WHISPER', status: 409 });
  const wav = `${workBase}.wav`;
  try {
    await run(bin.ffmpeg, ['-y', '-i', inputFile, '-t', '30', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    const vol = await run(bin.ffmpeg, ['-nostats', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']);
    const max = parseFloat(/max_volume:\s*(-?[\d.]+)/.exec(vol.err)?.[1] ?? '-91');
    if (max < -45) return { text: '', silent: true };
    const { out } = await run(bin.whisper, ['-m', model, '-f', wav, '-l', 'en', '-nt', '-np']);
    const text = out.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); // drop [BLANK_AUDIO], (music)
    return { text, silent: !text };
  } finally {
    await unlink(wav).catch(() => {});
  }
}
