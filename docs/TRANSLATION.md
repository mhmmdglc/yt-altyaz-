# Translation (HY-MT1.5-1.8B)

Subtitles are translated on your computer by **HY-MT1.5-1.8B**, a translation model from Tencent (1.8 billion parameters, 33 languages plus dialects, 37 target languages in this app). The internet is only needed once, to download the model. During translation no text leaves your computer.

Translation is **optional**. Without it you still get download, transcription, cards, word-by-word reading and shadowing, with English-only subtitles.

## License

The model is released under the **Tencent HY Community License** (`License.txt` is saved next to the model). The important point:

> The license **does not apply in the European Union, the United Kingdom and South Korea**, and using the model or its output there is not licensed.

You are responsible for checking that you may use it where you live. This project does not include or redistribute the model; `npm run setup` downloads it from Hugging Face on your request, and only after you confirm the license (`--accept-hymt-license` in non-interactive mode). If you are in one of those regions, skip the translation model; everything else works without it. Support for an additional, more permissively licensed translation model would be a welcome contribution (see [CONTRIBUTING](../CONTRIBUTING.md)).

## Install

Prerequisite: `llama-server` from [llama.cpp](https://github.com/ggml-org/llama.cpp) (`brew install llama.cpp`, see [INSTALL.md](INSTALL.md)).

```bash
npm run setup                                  # interactive: asks, shows the license note
npm run setup -- --translator --accept-hymt-license   # non-interactive
```

What it does:

1. Gets the expected sha256 of the file from Hugging Face.
2. Downloads to `<name>.part`, resuming after interruptions, and renames it only when the checksum matches, so a half-finished download is never mistaken for an installed model.
3. Saves `License.txt` and the model card next to the model.

| | |
|---|---|
| Model file | `HY-MT1.5-1.8B-Q8_0.gguf`, 1.9 GB (8-bit; the quality is best and the file is small) |
| Location | `~/models/HY-MT1.5-1.8B/`, **outside the project**, so other programs can use the same file |
| Memory | about 2.4 GB RAM while the server runs |
| Speed (Apple silicon, 48 GB) | about 3 sentences/second: a 241-card video in ~80 s; server start ~1.5 s |
| Server | `http://127.0.0.1:8081` (OpenAI-compatible API, model name `hy-mt`), loopback only |

Other quantizations: `HYMT_QUANT=Q6_K` (1.5 GB) or `Q4_K_M` (1.1 GB, slightly lower quality, faster). Run setup and the app with the same variable.

## The translation server

The app starts the server when it needs it. To manage it yourself:

```bash
npm run translator -- start      # start (does nothing if already running)
npm run translator -- stop       # stop and free ~2.4 GB of RAM; it restarts on the next translation
npm run translator -- restart
npm run translator -- status
npm run translator -- logs       # last 50 log lines
npm run translator -- test de    # translate one test sentence into German
```

The process id and log live in `~/.local/state/hy-mt/` (`%LOCALAPPDATA%\hy-mt` on Windows), not in the project. The app never stops the server by itself.

## How the app uses it

- **New video:** when transcription is done and a target language is set, translation starts in the background; the video shows a progress bar and the cards fill in.
- **Older videos / new language:** a bar above the cards offers **🌐 Translate**.
- A card with several sentences is translated **sentence by sentence**; the pieces are stored in `trParts`, which is how the colours match.
- Translations are saved every 20 cards; if interrupted, finished cards are kept and the button completes the rest.
- To redo a whole video: `curl -X POST -H 'Content-Type: application/json' -d '{"force":true}' localhost:3000/api/project/<id>/translate`

## Using the model from other programs

While the server runs, any program can use its OpenAI-compatible API:

```bash
npm run translator -- start
curl -s http://127.0.0.1:8081/v1/chat/completions -H 'Content-Type: application/json' -d '{
  "model": "hy-mt",
  "temperature": 0.7, "top_p": 0.6, "top_k": 20, "repeat_penalty": 1.05,
  "messages": [{"role": "user",
    "content": "Translate the following segment into Turkish, without additional explanation.\n\nIt is on the house."}]
}'
```

- Official prompt template for pairs without Chinese: `Translate the following segment into {target_language}, without additional explanation.\n\n{source_text}`. Use the English language name (`Turkish`, `German`, …).
- For Chinese targets (`中文`, `繁体中文`, `粤语`) the model card gives a Chinese template: `将以下文本翻译为{target_language}，注意只需要输出翻译后的结果，不要额外解释：\n\n{source_text}`. The app does this automatically.
- Recommended sampling (from the model card): `top_k 20, top_p 0.6, repetition_penalty 1.05, temperature 0.7`.
- You can also run the file directly: `llama-cli -m ~/models/HY-MT1.5-1.8B/HY-MT1.5-1.8B-Q8_0.gguf -ngl 99 -cnv`.

## Quality notes and limits

- Every sentence is translated **on its own**; the model does not see the sentences around it. Ambiguous words in a single sentence can be translated wrongly ("trunks" = elephant trunks or luggage?).
- The model's contextual template (translate the previous lines as context) was tried and **not used**: it sometimes copied the context lines into the output and even invented sentences.
- Archaic or very idiomatic English can go wrong ("Four score and seven years ago" came out as "Seven years ago").
- **Word meanings** translate the word alone, so words with several senses show one of them.
- Religious terms and names (for example Arabic words in English speech) may be translated incorrectly. Use the translation as an aid for understanding, not as a source.

## Troubleshooting

| Problem | What to do |
|---|---|
| "The translation model is not installed" | `npm run setup` |
| "The translation server could not be started" | `npm run translator -- logs`; is `llama-server` installed (`npm run doctor`)? |
| Port 8081 is used by another program | `HYMT_PORT=8082 npm run translator -- restart` and start the app with the same `HYMT_PORT` |
| "failed to load model" | The file may be damaged: delete the `.gguf` and run `npm run setup` again |
| Log mentions an unknown model architecture | `llama.cpp` is too old: `brew upgrade llama.cpp` (tested with build b10050) |
| Very slow | Another GPU-heavy program is running, or no GPU: try `HYMT_QUANT=Q4_K_M` |
| Everything in a video is badly translated | Redo it with the `force` command above |

## Remove

```bash
npm run translator -- stop
rm -rf ~/models/HY-MT1.5-1.8B ~/.local/state/hy-mt
```

Translations already stored in your videos stay; the app works without the model.
