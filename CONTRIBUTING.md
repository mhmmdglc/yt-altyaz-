# Contributing

Thanks for helping! Bug reports, fixes, translations of the interface, and testing on Linux/Windows are all valuable.

## Set up

```bash
git clone https://github.com/mhmmdglc/yt-altyaz-.git yt-altyazi
cd yt-altyazi
npm install
npm run doctor      # what do you still need? see docs/INSTALL.md
npm run setup
npm run dev         # restarts the server when you edit server-side files
npm test
```

The interface is plain JavaScript modules in `public/`; reload the page to see changes. There is no build step. Please keep it that way and avoid adding dependencies unless they clearly pay for themselves.

## Before you open a pull request

- `npm test` passes (it runs on Linux, macOS and Windows in CI).
- If you change behavior, update the docs (`README.md`, `docs/`).
- New interface text goes into **every** language in `public/locales.js` (`npm test` checks the keys).
- Add a test when you fix a bug or add logic. Segmentation logic (`segmenter.js`) and anything touching file paths or the network API deserves one.
- Keep comments and identifiers in English.
- Small, focused pull requests are easier to review.

## Translating the interface

Interface text lives in `public/locales.js`.

1. Copy the `en` object to a new one (for example `de`) and translate the values. Keep `{placeholders}` as they are. Plural counts use `key.one` / `key.other` (add `.few`, `.many`, … if your language needs them; `.other` is required).
2. Register it: add `de` to `LOCALES` and `de: 'Deutsch'` to `LOCALE_NAMES`.
3. `npm test`. The test fails if a key or a placeholder is missing.
4. Open the app, choose the language in **⚙ Settings**, and click through the screens.

The *translation* language (the language subtitles are translated into) is separate: it is chosen from the 37 languages HY-MT supports and needs no code change.

## Ideas that would help a lot

- **Testing on Linux and Windows**, and fixing what breaks (`docs/INSTALL.md` marks them untested).
- **Other source languages** (the app is English-only because the Whisper models used are `.en`).
- **Another translation backend** with a permissive license (HY-MT's license excludes the EU, UK and South Korea).
- Accessibility improvements, mobile layout, more interface languages.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
