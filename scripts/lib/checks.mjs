// Checks for the external tools the app needs, with install hints per platform.
import { execFileSync } from 'node:child_process';
import { bin, which, findWhisperModel, TRANSLATOR, IS_WINDOWS } from '../../config.js';
import { modelInstalled } from '../../translator.js';

const version = (file, args) => {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 }).split('\n').map((l) => l.trim()).find(Boolean) || '';
  } catch (e) {
    return String(e.stdout || e.stderr || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  }
};

export function platformInstallHelp() {
  const hasBrew = !!which('brew');
  if (process.platform === 'darwin') {
    return {
      manager: hasBrew ? 'brew' : null,
      command: 'brew install node ffmpeg yt-dlp whisper-cpp llama.cpp',
      note: hasBrew ? '' : 'Homebrew is not installed: https://brew.sh'
    };
  }
  if (IS_WINDOWS) {
    return {
      manager: null,
      command: 'winget install Gyan.FFmpeg yt-dlp.yt-dlp ggml.llamacpp',
      note: 'whisper.cpp: download whisper-bin-x64.zip from https://github.com/ggml-org/whisper.cpp/releases, unzip it and add the folder (it contains whisper-cli.exe) to your PATH, or set WHISPER_BIN.'
    };
  }
  return {
    manager: hasBrew ? 'brew' : null,
    command: hasBrew
      ? 'brew install ffmpeg yt-dlp whisper-cpp llama.cpp'
      : 'sudo apt install ffmpeg   # then: pipx install yt-dlp',
    note: hasBrew ? '' : 'whisper.cpp and llama.cpp: install Homebrew for Linux (https://brew.sh) and run `brew install whisper-cpp llama.cpp`, or build them from source (see docs/INSTALL.md).'
  };
}

// Returns [{ name, ok, required, detail, hint }]
export function checkEnvironment() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const tool = (name, file, args, required, hint) => {
    const found = which(file);
    return { name, ok: !!found, required, detail: found ? version(found, args) || found : 'not found', hint };
  };
  const whisperModel = findWhisperModel();
  return [
    { name: 'Node.js ≥ 20', ok: nodeMajor >= 20, required: true, detail: `v${process.versions.node}`, hint: 'https://nodejs.org' },
    tool('ffmpeg', bin.ffmpeg, ['-version'], true, 'audio extraction'),
    tool('yt-dlp', bin.ytdlp, ['--version'], true, 'video download'),
    tool('whisper-cli (whisper.cpp)', bin.whisper, ['--help'], true, 'transcription'),
    { name: 'Whisper model', ok: !!whisperModel, required: true, detail: whisperModel || 'not installed', hint: 'npm run setup' },
    tool('llama-server (llama.cpp)', bin.llamaServer, ['--version'], false, 'translation (optional)'),
    { name: 'Translation model (HY-MT)', ok: modelInstalled(), required: false, detail: modelInstalled() ? TRANSLATOR.modelPath : 'not installed', hint: 'optional: npm run setup' }
  ];
}

export function printChecks(results) {
  for (const r of results) {
    const mark = r.ok ? '✓' : r.required ? '✗' : '–';
    console.log(`  ${mark} ${r.name.padEnd(28)} ${r.ok ? r.detail : `${r.detail}${r.hint ? `  (${r.hint})` : ''}`}`);
  }
}
