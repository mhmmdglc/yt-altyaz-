# Installation

YT Altyazı needs **Node.js 20+** and four command-line tools. Models are downloaded by `npm run setup`.

| Tool | Used for | Required |
|---|---|---|
| [Node.js](https://nodejs.org) 20+ | runs the app | yes |
| [ffmpeg](https://ffmpeg.org) | audio extraction, silence detection | yes |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | downloading videos | yes |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-cli`) | speech to text | yes |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) | running the translation model | only for translation |

After installing, run:

```bash
npm install
npm run setup    # verifies the tools, downloads the Whisper model and (optionally) the translation model
npm start
```

`npm run doctor` prints a checklist of what is installed. `npm run setup` is safe to run again at any time.

## macOS (tested: Apple Silicon)

```bash
brew install node ffmpeg yt-dlp whisper-cpp llama.cpp
```

Apple Silicon uses the GPU (Metal) for both Whisper and the translation model. Intel Macs work but are much slower.

**Desktop shortcut (optional):** `npm run setup` offers it at the end (answer *Y*). You can add it any time with:

```bash
npm run shortcut
```

It puts a *YT Altyazı* shortcut on your Desktop that starts the server and opens the browser: an app on macOS (`npm run shortcut -- --browser "Google Chrome"` chooses the browser), a `.lnk` shortcut on Windows, a `.desktop` launcher on Linux (also in the applications menu; if your desktop calls it untrusted, right-click it and choose *Allow Launching*). The shortcut points at this folder and at the Node.js that created it: if you move either, run `npm run shortcut` again. `npm run setup -- --shortcut` creates it without asking, `--no-shortcut` never asks. The Windows and Linux shortcuts are written to the platforms' documented formats but have not been tried on real machines yet; please report problems.


## Mac app for someone else (.dmg, no installation)

To give the app to someone who does not use a terminal, build a self-contained Mac app on your Apple Silicon Mac:

```bash
npm run package:mac
```

The result is `dist/YT-Altyazi-<version>-macos-arm64.dmg` (about 3 GB). Open it, drag *YT Altyazı* to *Applications*, double-click. Nothing else has to be installed: Node.js, yt-dlp, ffmpeg, whisper.cpp, llama.cpp and the models are inside. It runs on **Apple Silicon (M1 or newer) with macOS 13 (Ventura) or newer**; Intel Macs are not supported. The app keeps running in the background until you quit it (⌘Q or Dock → Quit); videos and settings live in `~/Library/Application Support/YT Altyazı`, and API keys can go in a `.env` file there.

How it is built: the first run downloads the sources of whisper.cpp, llama.cpp and ffmpeg and the official `yt-dlp_macos` (checked against its published SHA-256) and compiles them for macOS 13 (static, no Homebrew libraries; a few minutes); later runs only assemble the app. The models come from your own `models/` folder and `~/models/HY-MT1.5-1.8B` (`WHISPER_MODEL_FILE`, `TRANSLATOR_DIR` and `NO_TRANSLATOR=1` change that). The app is signed ad hoc only, so macOS asks for a one-time approval on the first launch (System Settings → Privacy & Security → *Open Anyway*); the dmg has a note about it in Turkish. The bundled Node.js is too old for yt-dlp's JavaScript challenge solver, so YouTube may offer fewer formats than with a full yt-dlp setup.

The dmg contains third-party software and the HY-MT model: keep it for personal use, or read [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and the model license before sharing it (the HY-MT license excludes the EU, the UK and South Korea).

## Linux (not yet tested end-to-end)

```bash
sudo apt install ffmpeg            # or your distribution's package
pipx install yt-dlp                # the distribution package is often outdated
```

`whisper.cpp` and `llama.cpp` are usually not in the distribution repositories. Two ways:

- **Homebrew on Linux** (easiest): install from <https://brew.sh>, then `brew install whisper-cpp llama.cpp`.
- **Build from source:** follow each project's README, then put `whisper-cli` and `llama-server` on your `PATH`, or point to them with `WHISPER_BIN` and `LLAMA_SERVER_BIN` (see [CONFIGURATION.md](CONFIGURATION.md)).

Without a GPU, transcription and translation run on the CPU and are several times slower. Use a smaller Whisper model (`npm run setup -- --whisper small.en`).

## Windows (not yet tested end-to-end)

```powershell
winget install OpenJS.NodeJS Gyan.FFmpeg yt-dlp.yt-dlp ggml.llamacpp
```

`whisper.cpp` has no winget package: download `whisper-bin-x64.zip` from the [releases page](https://github.com/ggml-org/whisper.cpp/releases), unzip it, and add the folder containing `whisper-cli.exe` to your `PATH` (or set `WHISPER_BIN`). Open a new terminal afterwards so the new `PATH` is picked up.

WSL2 with the Linux instructions also works.

## Choosing models

**Whisper** (speech to text, English-only models; larger is more accurate and slower):

| Model | Size | Notes |
|---|---|---|
| `medium.en` | 1.5 GB | best accuracy, recommended |
| `small.en` | 466 MB | good for older or CPU-only computers |
| `base.en` | 142 MB | fastest, least accurate |

```bash
npm run setup -- --whisper small.en
```

If several models are installed, the best one is used. Force one with `WHISPER_MODEL=small.en`.

**Translation (optional):** `npm run setup -- --translator --accept-hymt-license` downloads HY-MT1.5-1.8B (1.9 GB). **Read the [license note](TRANSLATION.md#license) first**: the model may not be used in the EU, UK and South Korea.

### Manual download

If you prefer to download the models yourself, put the files here:

- Whisper: `models/ggml-medium.en.bin` (from <https://huggingface.co/ggerganov/whisper.cpp>)
- Translation: `~/models/HY-MT1.5-1.8B/HY-MT1.5-1.8B-Q8_0.gguf` (from <https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF>)

## Updating

```bash
git pull
npm install
npm run setup    # picks up anything new
```

Update yt-dlp regularly (`brew upgrade yt-dlp` or `pipx upgrade yt-dlp`): video sites change often and old versions stop working.

## Troubleshooting

| Problem | What to do |
|---|---|
| `npm run doctor` says a tool is missing | Install it as shown above; open a **new** terminal so `PATH` refreshes. |
| `EADDRINUSE` / "Port 3000 is in use" | Another program uses the port: `PORT=3001 npm start`. If it is this app already, it is simply opened. |
| Download fails with `403` or "Sign in to confirm" | Update yt-dlp. Some videos need cookies: see the yt-dlp documentation. |
| Transcription is very slow | Use a smaller model (`small.en`), close GPU-heavy apps, check that `whisper-cli` is the Metal/GPU build. |
| Subtitles have no punctuation or cards are huge | See [SUBTITLE-CARDS.md](SUBTITLE-CARDS.md#recordings-without-punctuation). |
| Translation does not start | `npm run translator -- logs`, then see [TRANSLATION.md](TRANSLATION.md#troubleshooting). |
| Nothing opens in the browser | Open the address printed in the terminal (`http://localhost:3000`). |

Still stuck? Run `npm run doctor`, then open an issue and include its output.

## Uninstall

Delete the project folder. The translation model lives outside it: remove `~/models/HY-MT1.5-1.8B` and `~/.local/state/hy-mt` if you no longer need them.
