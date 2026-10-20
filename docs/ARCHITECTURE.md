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
| `exec.js`, `open-browser.js` | run a command; open the default browser |
| `public/` | `index.html`, `app.js` (ES module), `i18n.js`, `locales.js`, `style.css` |
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
      "tr": "Cümle bir. Cümle iki.",
      "trParts": ["Cümle bir.", "Cümle iki."]
    }
  ]
}
```

`sents` is the exact sentence list of the card; `trParts` the translation per sentence (only for multi-sentence cards); `trLang` the language of `tr`. `words.json` holds `{ words: [{ w, s, e }], silences: [{ a, b }] }`. Also in `data/`: `settings.json` (`{ "targetLang": "tr" }`).

## HTTP API

The API is meant for the bundled interface and may change. All responses are JSON; errors look like `{ "error": "message", "code": "NO_LANG" }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | `{ targetLang, languages, translator: {installed, running}, whisperModel }` |
| `PUT` | `/api/settings` | `{ targetLang }` |
| `POST` | `/api/transcribe` | `{ url }` → `{ jobId }`; jobs run one at a time |
| `GET` | `/api/job/:id` | `{ status: queued\|running… , stage, error, code, project }` |
| `GET` | `/api/projects` | list: id, title, url, createdAt, segmentCount, translated, trLang, duration |
| `GET` | `/api/project/:id` | the whole project |
| `DELETE` | `/api/project/:id` | delete the video and its files |
| `GET` | `/api/project/:id/video` | the video (supports range requests) |
| `POST` | `/api/project/:id/translate` | start translating (`{ force: true }` redoes all cards) |
| `GET` | `/api/project/:id/translate` | `{ status: idle\|running\|done\|error, done, total, lang, error }` |
| `GET` | `/api/word?w=word` | `{ word, expanded, tr }` meaning in the target language |

Error codes the interface translates: `NO_LANG`, `NO_MODEL`, `NO_WHISPER`, `NO_SPEECH`, `BAD_URL`, `TRANSLATOR_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_ID`, `INTERNAL`.

## Design notes

- **Local-only by default.** The server binds to `127.0.0.1`, rejects foreign `Host` headers (DNS rebinding) and cross-origin state-changing requests, validates every `:id` before it touches the file system, only accepts `http(s)` links, passes URLs to yt-dlp after `--`, and never uses a shell. See [SECURITY.md](../SECURITY.md).
- **One writer per project file.** Translation jobs write `project.json` through a per-project lock, in batches of 20 cards.
- **Translation is a separate process** (`llama-server`) that outlives the app and can be shared with other programs.
- **Cards are data, not a view.** They are built once (and rebuilt with `npm run regroup`); the interface only renders them.
- **Cross-platform tooling in Node.** Setup, downloads, process management and the doctor are JavaScript, so there are no shell scripts to port (only the optional macOS launcher).
