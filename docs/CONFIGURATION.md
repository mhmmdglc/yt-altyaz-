# Configuration

Everything works with the defaults. Change behavior with environment variables, for example:

```bash
PORT=3001 npm start
DATA_DIR=/Volumes/Big/yt-altyazi npm start
WHISPER_MODEL=small.en npm start
```

On Windows PowerShell: `$env:PORT=3001; npm start`.

## App

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port of the web app |
| `HOST` | `127.0.0.1` | Address to listen on. The default serves only this computer. **Do not set it to `0.0.0.0`** unless you understand that the app has no login: anyone on the network could then use it (the app prints a warning). |
| `DATA_DIR` | `./data` | Your library: videos, subtitles, translations, `settings.json` |
| `WORK_DIR` | `./work` | Temporary files (can be deleted when the app is not running) |
| `MODELS_DIR` | `./models` | Whisper models |

Starting the app with `npm start` opens your browser. `npm run dev` (restarts on changes) does not. If the port is already used by this app, `npm start` just opens it.

## Tools and models

| Variable | Default | Meaning |
|---|---|---|
| `WHISPER_MODEL` | best installed | `medium.en`, `small.en`, `base.en` or a path to a `ggml-*.bin` file |
| `WHISPER_BIN` | `whisper-cli` | Path to whisper.cpp's CLI (`whisper-cpp` is also tried) |
| `FFMPEG_BIN` | `ffmpeg` | |
| `YTDLP_BIN` | `yt-dlp` | |
| `LLAMA_SERVER_BIN` | `llama-server` | |
| `HYMT_MODEL_DIR` | `~/models/HY-MT1.5-1.8B` | Folder with the translation model |
| `HYMT_QUANT` | `Q8_0` | `Q8_0`, `Q6_K` or `Q4_K_M` |
| `HYMT_PORT` | `8081` | Port of the translation server |
| `HYMT_PARALLEL` | `4` | Parallel requests the translation server handles |
| `HYMT_URL` | `http://127.0.0.1:$HYMT_PORT` | Use a translation server that is already running elsewhere |
| `HYMT_STATE_DIR` | `~/.local/state/hy-mt` | pid and log of the translation server |
| `GEMINI_API_KEY` | (none) | Gemini key for the optional AI features; overrides the key saved in Settings ([AI.md](AI.md)) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model id; overrides the model saved in Settings |
| `GEMINI_API_BASE` | Google's endpoint | Another Gemini-compatible endpoint (used by the tests) |

When the app is started from a launcher (Finder, Start menu) the `PATH` is minimal; the app adds the usual places (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`), or set the `*_BIN` variables.

## Other scripts

| Variable | Used by | Meaning |
|---|---|---|
| `APP_URL` | `npm run regroup` | Address of the running app (default `http://localhost:$PORT`) |
| `BROWSER_APP` | macOS launcher | Browser to open, e.g. `Google Chrome` |

## Settings saved by the app

- `DATA_DIR/settings.json`: translation language (`targetLang`), level (`level`), and if you saved them in Settings the Gemini key and model (`geminiApiKey`, `geminiModel`). The key is stored in plain text on your computer; keep the folder private.
- `DATA_DIR/favorites.json`: saved sentences and their review schedule.
- `DATA_DIR/ai-cache.json`: cached Gemini answers (safe to delete).
- Browser `localStorage`: interface language, show/hide translation, colours, text-only mode, playback speed, resume positions. These are per browser.

## Folders

```
yt-altyazi/
├── server.js, config.js, translator.js, transcribe.js, segmenter.js, …   code
├── public/        the web interface
├── scripts/       setup, doctor, translator and regroup commands
├── test/          automated tests (npm test)
├── docs/          documentation
├── data/          your library            (ignored by git)
├── models/        Whisper models          (ignored by git)
└── work/          temporary files         (ignored by git)
```
