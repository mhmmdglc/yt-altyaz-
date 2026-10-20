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

**Double-click app (optional):** `scripts/create-macos-app.sh` puts a *YT Altyazı* app on your Desktop that starts the server and opens the browser. Use `--browser "Google Chrome"` to choose a browser. If you move the project folder, run the script again.

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
