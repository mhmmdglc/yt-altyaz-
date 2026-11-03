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
| `gemini.js` | optional Gemini client: prompts, JSON schemas, error mapping (Vary, Study, word meanings in context) |
| `deepseek.js` | optional DeepSeek client (OpenAI-compatible, JSON mode), the fallback when Gemini cannot answer |
| `ai.js` | provider router: Gemini first, DeepSeek on failure, Gemini paused for 15 minutes after a quota error |
| `ai-cache.js` | cache of AI answers (`data/ai-cache.json`) |
| `ai-split.js` | *Split into short parts with AI*: batches, prompt and schema, checking the AI's parts against the transcript (exact, then word alignment), parts → cards |
| `favorites.js`, `public/srs.js` | saved sentences and the spaced-repetition scheduler (shared with the browser) |
| `library.js` | finds sentences with a pattern in your own library |
| `store.js` | small JSON file store with a write queue |
| `exec.js`, `open-browser.js` | run a command; open the default browser |
| `public/` | `index.html`, `app.js` (main module), `study.js` (🎯 Study page and the 🎤 widget), `recorder.js` (microphone), `speech-match.js` (word-by-word comparison, shared with the tests), `vary.js` (Vary panel), `favorites-view.js` (Favorites and Review pages), `fav-store.js`, `clip.js` (sentence and speech playback), `util.js`, `i18n.js`, `locales.js`, `style.css` |
| `scripts/` | `setup`, `doctor`, `translator` (CLI), `regroup`, macOS launcher helpers |
| `test/` | `node:test` tests: segmenter, AI split, locales, translator prompts, download, server security/API |

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

`data/<id>/ai-split.json` (only after *Split into short parts with AI*): `{ version, createdAt, provider, model, level, lang, wordsHash, stats, cards }`, where `cards` have the card shape above with one sentence each and the AI's translation in `tr` / `trParts`. `project.json` → `split: "ai"` when the AI cards are shown (absent: original). `segments` in `project.json` are always the original cards.

## HTTP API

The API is meant for the bundled interface and may change. All responses are JSON; errors look like `{ "error": "message", "code": "NO_LANG" }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | `{ targetLang, languages, level, levels, translator, whisperModel, ai: { configured, source, model, keyHint } }` (never the key itself) |
| `PUT` | `/api/settings` | any of `{ targetLang, level, geminiApiKey, geminiModel }` (`""` removes the key or model) |
| `POST` | `/api/transcribe` | `{ url }` → `{ jobId }`; jobs run one at a time |
| `GET` | `/api/job/:id` | `{ status: queued\|running… , stage, error, code, project }` |
| `GET` | `/api/projects` | list: id, title, url, createdAt, segmentCount, translated, trLang, duration |
| `GET` | `/api/project/:id` | the project with the cards of the active view as `segments`, plus `split: original\|ai`, `hasAiSplit`, `aiSplitStale`, `aiSplit` (summary); `?view=original\|ai` asks for one view without changing the choice |
| `POST` | `/api/project/:id/ai-split` | start the AI split in the background (409 `AI_SPLIT_RUNNING` while one runs) |
| `GET` | `/api/project/:id/ai-split` | `{ status: idle\|running\|done\|error, done, total, error, code }` (batches) |
| `DELETE` | `/api/project/:id/ai-split` | remove the AI split (the view goes back to original) |
| `PUT` | `/api/project/:id/split` | `{ mode: original\|ai }`: which cards the video shows |
| `DELETE` | `/api/project/:id` | delete the video and its files |
| `GET` | `/api/project/:id/video` | the video (supports range requests) |
| `POST` | `/api/project/:id/translate` | start translating (`{ force: true }` redoes all cards) |
| `GET` | `/api/project/:id/translate` | `{ status: idle\|running\|done\|error, done, total, lang, error }` |
| `GET` | `/api/word?w=word&s=sentence` | `{ word, tr, expanded?, lemma?, pos?, note?, source: gemini\|local }` meaning in the target language |
| `POST` | `/api/ai/vary` | `{ text, context?, more? }` → `{ pattern, explanation, examples: [{ en, tr }], library: [...], level }` |
| `POST` | `/api/ai/test` | checks one provider's key and model (`{provider: 'gemini' \| 'deepseek'}`) |
| `POST` | `/api/ai/drill` | `{ text, context?, fresh? }` → `{ pattern, explanation, steps: [{ label, native, en, alternatives, hint }], level }` |
| `POST` | `/api/speech` | raw audio (webm/opus, mp4…, ≤ 10 MB, first 30 s) → `{ text, silent }`, transcribed locally by Whisper; the recording is deleted |
| `GET` | `/api/favorites` | `{ items, due }` |
| `POST` | `/api/favorites` | `{ projectId, cardIndex, sentIndex, view? }` (`view: "ai"` when the index is an AI-split card; the item stores its text, translation and times) or `{ kind: "example" \| "drill", text, tr, pattern }` (drill items are reviewed from your language to English) |
| `DELETE` | `/api/favorites/:id` | remove |
| `POST` | `/api/favorites/:id/review` | `{ grade: again\|hard\|good\|easy }` → the item with its new schedule |
| `GET` | `/api/favorites/export.tsv` | tab-separated export for Anki |

Error codes the interface translates: `NO_LANG`, `NO_MODEL`, `NO_WHISPER`, `NO_SPEECH`, `BAD_URL`, `TRANSLATOR_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_ID`, `INTERNAL`, `BAD_AUDIO`, `SPEECH_FAILED`, `NO_AI_KEY`, `AI_KEY_INVALID`, `AI_QUOTA`, `AI_OFFLINE`, `AI_MODEL`, `AI_BLOCKED`, `AI_FAILED`, `BAD_KEY`, `BAD_LEVEL`, `BAD_TEXT`, `BAD_MODEL`, `BAD_GRADE`, `AI_SPLIT_RUNNING`, `NO_WORDS`, `NO_AI_SPLIT`, `BAD_MODE`.

## Design notes

- **Local-only by default.** The server binds to `127.0.0.1`, rejects foreign `Host` headers (DNS rebinding) and cross-origin state-changing requests, validates every `:id` before it touches the file system, only accepts `http(s)` links, passes URLs to yt-dlp after `--`, and never uses a shell. See [SECURITY.md](../SECURITY.md).
- **One writer per project file.** Translation jobs and the view switch write `project.json` through a per-project lock (translations in batches of 20 cards). The AI split has its own file and never touches the original cards.
- **Translation is a separate process** (`llama-server`) that outlives the app and can be shared with other programs.
- **Cards are data, not a view.** They are built once (and rebuilt with `npm run regroup`); the interface only renders them.
- **Cross-platform tooling in Node.** Setup, downloads, process management and the doctor are JavaScript, so there are no shell scripts to port (only the optional macOS launcher).
