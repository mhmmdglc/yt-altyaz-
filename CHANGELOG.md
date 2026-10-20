# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
