# Architecture

A small Node.js (Express) server plus a plain HTML/CSS/JavaScript interface. No build step, no database: your library is a folder of files.

## Code layout

| File | Responsibility |
|---|---|
| `server.js` | HTTP API, job queue, translation jobs, security checks |
| `config.js` | Paths, environment variables, tool and model lookup, id validation |
| `transcribe.js` | video → audio → Whisper word timestamps + silence map |
| `segmenter.js` | words → sentences → time snapping → cards (pure functions, unit-tested) |
| `translator.js` | HY-MT client, translation-server management (`llama-server`), prompt templates |
| `languages.js` | supported target languages |
| `gemini.js` | optional Gemini client: prompts, JSON schemas, error mapping (Vary, word meanings in context) |
| `ai-cache.js` | cache of AI answers (`data/ai-cache.json`) |
| `favorites.js`, `public/srs.js` | saved sentences and the spaced-repetition scheduler (shared with the browser) |
| `library.js` | finds sentences with a pattern in your own library |
| `store.js` | small JSON file store with a write queue |
| `exec.js`, `open-browser.js` | run a command; open the default browser |
| `public/` | `index.html`, `app.js` (main module), `study.js` (🎯 Study page and the 🎤 widget), `recorder.js` (microphone), `speech-match.js` (word-by-word comparison, shared with the tests), `vary.js` (Vary panel), `favorites-view.js` (Favorites and Review pages), `fav-store.js`, `clip.js` (sentence and speech playback), `util.js`, `i18n.js`, `locales.js`, `style.css` |
| `scripts/` | `setup`, `doctor`, `translator` (CLI), `regroup`, macOS launcher helpers |
| `test/` | `node:test` tests: segmenter, locales, translator prompts, download, server security/API |

## Data format

`data/<id>/project.json` (the id is a UUID):

```json
{
  "id": "7d3e5c1a-0b2f-4e8a-9c64-1f2a3b4c5d6e",
  "title": "Video title",
  "url": "https://…",
  "createdAt": "2026-01-01T12:00:00.000Z",
  "trLang": "tr",
  "segments": [
    {
      "start": 0.4, "end": 7.3,
      "text": "Sentence one. Sentence two.",
      "sents": ["Sentence one.", "Sentence two."],
      "sentTimes": [[0.4, 3.1], [3.2, 7.3]],
      "tr": "Cümle bir. Cümle iki.",
      "trParts": ["Cümle bir.", "Cümle iki."]
    }
  ]
}
```

`sents` is the exact sentence list of the card and `sentTimes` the time range of each sentence; `trParts` the translation per sentence (only for multi-sentence cards); `trLang` the language of `tr`. `words.json` holds `{ words: [{ w, s, e }], silences: [{ a, b }] }`. Also in `data/`: `settings.json` (`{ "targetLang": "tr" }`).

## HTTP API

The API is meant for the bundled interface and may change. All responses are JSON; errors look like `{ "error": "message", "code": "NO_LANG" }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | `{ targetLang, languages, level, levels, translator, whisperModel, ai: { configured, source, model, keyHint } }` (never the key itself) |
| `PUT` | `/api/settings` | any of `{ targetLang, level, geminiApiKey, geminiModel }` (`""` removes the key or model) |
| `POST` | `/api/transcribe` | `{ url }` → `{ jobId }`; jobs run one at a time |
| `GET` | `/api/job/:id` | `{ status: queued\|running… , stage, error, code, project }` |
| `GET` | `/api/projects` | list: id, title, url, createdAt, segmentCount, translated, trLang, duration |
| `GET` | `/api/project/:id` | the whole project |
| `DELETE` | `/api/project/:id` | delete the video and its files |
| `GET` | `/api/project/:id/video` | the video (supports range requests) |
| `POST` | `/api/project/:id/translate` | start translating (`{ force: true }` redoes all cards) |
| `GET` | `/api/project/:id/translate` | `{ status: idle\|running\|done\|error, done, total, lang, error }` |
| `GET` | `/api/word?w=word&s=sentence` | `{ word, tr, expanded?, lemma?, pos?, note?, source: gemini\|local }` meaning in the target language |
| `POST` | `/api/ai/vary` | `{ text, context?, more? }` → `{ pattern, explanation, examples: [{ en, tr }], library: [...], level }` |
| `POST` | `/api/ai/test` | checks the Gemini key and model |
| `POST` | `/api/ai/drill` | `{ text, context?, fresh? }` → `{ pattern, explanation, steps: [{ label, native, en, alternatives, hint }], level }` |
| `POST` | `/api/speech` | raw audio (webm/opus, mp4…, ≤ 10 MB, first 30 s) → `{ text, silent }`, transcribed locally by Whisper; the recording is deleted |
| `GET` | `/api/favorites` | `{ items, due }` |
| `POST` | `/api/favorites` | `{ projectId, cardIndex, sentIndex }` or `{ kind: "example" \| "drill", text, tr, pattern }` (drill items are reviewed from your language to English) |
| `DELETE` | `/api/favorites/:id` | remove |
| `POST` | `/api/favorites/:id/review` | `{ grade: again\|hard\|good\|easy }` → the item with its new schedule |
| `GET` | `/api/favorites/export.tsv` | tab-separated export for Anki |

Error codes the interface translates: `NO_LANG`, `NO_MODEL`, `NO_WHISPER`, `NO_SPEECH`, `BAD_URL`, `TRANSLATOR_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_ID`, `INTERNAL`, `BAD_AUDIO`, `SPEECH_FAILED`, `NO_AI_KEY`, `AI_KEY_INVALID`, `AI_QUOTA`, `AI_OFFLINE`, `AI_MODEL`, `AI_BLOCKED`, `AI_FAILED`, `BAD_KEY`, `BAD_LEVEL`, `BAD_TEXT`, `BAD_MODEL`, `BAD_GRADE`.

## Design notes

- **Local-only by default.** The server binds to `127.0.0.1`, rejects foreign `Host` headers (DNS rebinding) and cross-origin state-changing requests, validates every `:id` before it touches the file system, only accepts `http(s)` links, passes URLs to yt-dlp after `--`, and never uses a shell. See [SECURITY.md](../SECURITY.md).
- **One writer per project file.** Translation jobs write `project.json` through a per-project lock, in batches of 20 cards.
- **Translation is a separate process** (`llama-server`) that outlives the app and can be shared with other programs.
- **Cards are data, not a view.** They are built once (and rebuilt with `npm run regroup`); the interface only renders them.
- **Cross-platform tooling in Node.** Setup, downloads, process management and the doctor are JavaScript, so there are no shell scripts to port (only the optional macOS launcher).
