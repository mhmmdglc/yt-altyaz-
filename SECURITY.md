# Security

YT Altyazı is a **local** application: a web interface served from your own computer, with no accounts. It is designed to be reachable only from the machine it runs on.

## What the app does to stay safe

- Listens on `127.0.0.1` only (`HOST` can change this; the app warns when you do).
- Rejects requests with a foreign `Host` header (DNS rebinding) and state-changing requests from another origin (cross-site requests).
- Validates every project id before it reaches the file system (no `../` traversal); deleting a video can only remove its own folder under `DATA_DIR`.
- Only accepts `http`/`https` links for download, passes them to yt-dlp after `--`, and runs tools without a shell.
- The translation server (`llama-server`) listens on `127.0.0.1` only.
- Downloads of models are checksum-verified.

## What it cannot protect against

- Anyone who can already run code as you, or who can reach the port after you changed `HOST` to a public address. There is **no authentication**; do not expose the app to a network you do not trust.
- Malicious media files exploiting bugs in ffmpeg, yt-dlp or whisper.cpp: keep those tools updated.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's *Report a vulnerability* button (Security tab of the repository) to send a private report, and include the steps to reproduce and the affected version. You will get a response as soon as the maintainers can.
