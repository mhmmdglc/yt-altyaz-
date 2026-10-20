# Third-party software and models

YT Altyazı itself is MIT-licensed. It **does not bundle or redistribute** any of the software and models below: they are installed or downloaded by you (through your package manager or `npm run setup`) under their own licenses. Check each license for your situation.

| Component | Used for | License |
|---|---|---|
| [Node.js](https://nodejs.org) | runtime | MIT |
| [Express](https://expressjs.com) and its dependencies | web server (installed by `npm install`) | MIT and similar; see `node_modules/*/LICENSE` |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | speech to text | MIT |
| [Whisper models](https://github.com/openai/whisper) (OpenAI), in ggml format from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) | speech recognition | MIT |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | runs the translation model | MIT |
| [FFmpeg](https://ffmpeg.org) | audio extraction, silence detection | LGPL / GPL depending on the build; run as a separate program |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | downloading videos | Unlicense (public domain) |
| [HY-MT1.5-1.8B](https://huggingface.co/tencent/HY-MT1.5-1.8B) (Tencent) | translation | **Tencent HY Community License**: not valid in the European Union, the United Kingdom and South Korea; see `License.txt` next to the downloaded model and [docs/TRANSLATION.md](docs/TRANSLATION.md#license) |

The Gettysburg Address text used in the screenshots is in the public domain.
