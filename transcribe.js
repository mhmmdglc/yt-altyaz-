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
