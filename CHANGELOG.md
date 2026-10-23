# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-10-22

### Added
- **DeepSeek fallback** for the AI features: when Gemini cannot answer (quota used up, an error), the same request goes straight to DeepSeek, and after a quota error Gemini is skipped for 15 minutes. Key via `DEEPSEEK_API_KEY` or Settings; a DeepSeek key alone also works.
- A small **Gemini / DeepSeek** chip on Vary and Study answers; Settings shows when Gemini is paused, and each provider has its own **Test** button.

### Changed
- **Vary and Study are one page**: 🎯 opens a page with a 🎤 Speak tab and a ✨ Vary tab, so a sentence can be understood, varied and spoken in one place. The separate ✨ button on cards and favorites is gone.
- The level (A2–C1) moved from the top bar to that page, next to the tabs; it is still shown in Settings.
- AI error messages no longer name Gemini, since either provider may have answered.

## [1.2.0] - 2026-10-21

### Added
- **🎯 Study (speaking practice)**: one sentence becomes a speaking ladder (8–15 steps by level, built by Gemini): you see each step in your language, say it in English, and your recording is transcribed **locally** by Whisper and compared word by word (contractions, case and punctuation ignored). Blurred English with reveal, hints, read-aloud and repeat-until-stopped (shadowing), *I knew it / I didn't*, practise only the missed steps, list or one-by-one mode with keyboard shortcuts.
- Missed Study steps can be added to Review, where they are asked from your language to English with 🎤.
- Entry points: 🎯 on a card, *Study this pattern* in Vary, 🎯 on a favorite.

### Changed
- The Study prompt makes Gemini write the English first and then its translation, which keeps the two sentences equivalent; steps that only differ by a contraction are dropped.

## [1.1.0] - 2026-10-21

### Added
- **Favorites**: save any sentence (on multi-sentence cards you pick which one); a Favorites page to listen to the original audio, repeat it, jump back to the video, and export a tab-separated file for Anki.
- **Review** with spaced repetition (a simplified SM-2): listen, say it, reveal the translation, rate *Again / Hard / Good / Easy*; the ⭐ button shows how many sentences are due.
- **✨ Vary** (optional, Gemini API): the grammar pattern of a sentence, a short explanation in your language, new example sentences at your level with the pattern highlighted, read-aloud and save buttons, and real sentences with the same pattern from your own videos, playable with their original audio.
- **Word meanings in context** (optional, off by default: *Settings → Also use Gemini for word meanings*): the meaning that fits the sentence, with the dictionary form, part of speech and a usage note; falls back to the local model. By default word meanings and translations stay on the local model.
- **Level** (A2, B1, B2, C1; default B1) in the top bar and in Settings.
- Settings for the Gemini key (stored locally, never sent to the browser) and model, with a connection test.
- Per-sentence times in every card (`sentTimes`).
- A `.env` file in the project folder is read at start (see `.env.example`).

### Changed
- `npm run regroup` keeps the translations of cards whose text did not change.
- Compact top bar on narrow screens.

## [1.0.0] - 2026-10-20

First public release.

### Added
- Download videos with yt-dlp and transcribe them with whisper.cpp using word-level timestamps.
- Subtitle cards that never split a sentence, with start and end times snapped to the silences in the audio. Pause-based fallbacks for recordings without punctuation.
- Local translation with HY-MT1.5-1.8B into 37 languages; each card is translated sentence by sentence and every English sentence shares a colour with its translation.
- Click a word to see its meaning, shadowing loop for any card, text-only mode with a small player bar, video list drawer, resume position, playback speed, search, keyboard shortcuts.
- English and Türkçe interface; a settings dialog for the interface and translation languages.
- `npm run setup` (checks tools, downloads checksum-verified and resumable models), `npm run doctor`, `npm run translator`, `npm run regroup`.
- Optional macOS launcher app (`scripts/create-macos-app.sh`).
- Automated tests (segmentation, translation prompts, downloads, locales, server security) and CI on Linux, macOS and Windows.

### Security
- The server listens on `127.0.0.1` only by default, rejects foreign `Host` and cross-origin state-changing requests, validates every project id (no path traversal), accepts only `http(s)` links and never runs commands through a shell.
