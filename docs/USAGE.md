# Using YT Altyazı

## Adding a video

Press **＋ New video**, paste a link and press **Transcribe**. YouTube and every site supported by [yt-dlp](https://github.com/yt-dlp/yt-dlp) work. The window shows the progress (download → audio → transcription → cards). You can close it: the video opens by itself when it is ready, and the translation continues in the background.

Videos must be spoken in **English** (the Whisper models are English-only).

## The screen

- **Video** (left) and **subtitle cards** (right). The active card is highlighted and the list scrolls along. Scroll by hand and it stops following for a few seconds; **⤓ Back to the active card** brings you back.
- **☰ Videos** (top left) opens the list of your videos without leaving the page; **▦ All videos** goes to the home grid.
- **⚙ Settings** chooses the interface language and the language to translate into.

## Cards, translation and colours

Each card holds one or a few **whole sentences**; a sentence is never split across two cards (only comma-chained run-ons of more than 32 words are cut at a comma into shorter pieces). Below the English text you see the translation.

- **Show translation** hides/shows all translations (the setting is remembered).
- **Sentence colours:** when a card contains several sentences, each English sentence and its translation have the same colour (amber, mint, lilac). Switch it off for plain text.
- Click a card to jump to it. The search box finds text in the English subtitles and in the translations.

## Click a word

Click any English word and its meaning in your language appears under it. Without a Gemini key the word is translated on its own by the local model, so for words with several meanings it shows one of them; contractions are expanded first (`don't` → `do not`). If you turn on *Settings → Also use Gemini for word meanings* (needs a Gemini key, off by default), the meaning fits the sentence and you also see the dictionary form, the part of speech and sometimes a short usage note. Click elsewhere or press `Esc` to close it.

## Shadowing (repeat after the speaker)

1. Switch **Auto-continue** off. Now clicking a card plays only that card.
2. Hover a card and press **🔁**. The card plays, the app waits one second, and plays it again, over and over, until you press **⏹** on the same card.
3. Speak along, then try without listening. Lower the speed (0.75×) if the speaker is fast.

With **Auto-continue** on, playback keeps going down the list from the card you click.

## Favorites

Press **☆** on a card to save a sentence. On a card with several sentences a small menu asks which one; saved sentences get a ★. Press ☆ again (and pick the sentence) to remove it.

**⭐ Favorites** (top bar) lists every saved sentence with its translation and where it came from:

- **▶** plays the sentence with its original audio (examples are read aloud by your computer's voice), **🔁** repeats it for shadowing.
- **↗ Open in the video** jumps to that moment.
- **🎯 Study** works here too (with the **✨ Vary** tab).
- **⬇ Export for Anki** downloads a tab-separated file (English, translation, source). In Anki use *File → Import*; audio is not included.

## 🎯 Study (speaking practice)

Press **🎯** on a card (pick the sentence on a multi-sentence card) or **🎯 Study** on a favorite. One page for understanding a sentence completely: the **🎤 Speak** tab (the speaking ladder) and the **✨ Vary** tab (the pattern in new example sentences, see below). Needs a Gemini or DeepSeek key; your voice is processed only on your computer.

Your **level** (A2–C1) is chosen on this page, next to the tabs: the ladder and the examples are written for it, and changing it rebuilds both. It is remembered, and Settings shows it too.

The page shows the sentence (▶ plays its original audio), its pattern, and a ladder of steps (8 at A2, 12 at B1, 14 at B2, 15 at C1): the simplest core, other subjects, negative, question, added details, the full sentence, and a natural extension. Each step shows the sentence **in your language** and the English **blurred**.

- **🎤 Say it**: say the English and press **⏹ Done**. Whisper transcribes it locally and compares it word by word (contractions, case and punctuation do not matter): *✓ Great!* (marked as known), *≈ Almost* with the missing words, or *✗ Not quite* (marked as missed). The browser asks for microphone access the first time.
- **💡 Hint** shows one to three key words; **👁 Show** (or clicking the blur) reveals the English; **🔊** reads it, **🔁** repeats it until stopped.
- **✓ I knew it / ✗ I didn't** mark a step. The summary at the bottom lets you **practise only the missed steps** again or **add them to Review** (they are then reviewed from your language to English, with 🎤).
- **List / One by one**: one by one is keyboard friendly: `M` speak, `Space` show, `L` listen, `1` knew, `2` didn't, `←`/`→` move.
- **🔄 New set** writes a different ladder; otherwise the same sentence opens the same (cached) ladder.

## Review (spaced repetition)

**🧠 Review** shows the saved sentences that are due today, one at a time:

1. The sentence plays. Say it yourself and think of what it means.
2. Press **Show the translation** (`Space`).
3. Rate yourself: **Again** (back in 10 minutes, later in this session), **Hard**, **Good**, **Easy** (`1`–`4`). Each button shows when you will see the sentence again.

Sentences you know come back after longer and longer intervals (1 day, 3 days, about a week, …); the ones you miss come back soon. The number on the ⭐ button is how many sentences are due.

## ✨ Vary tab (optional, needs an AI key)

On the Study page, open the **✨ Vary** tab. The sentence's pattern (for example *be not good at + noun / verb-ing*) and a short explanation in your language are at the top of the page; the tab shows:

- **new example sentences** in the same pattern at your level, with the pattern words highlighted, 🔊 to hear them and ☆ to save them to your favorites; **＋ More examples** writes more;
- **real examples from your videos**: other sentences in your library with the same pattern, with ▶ to play their original audio.

See [AI.md](AI.md) for the key, privacy and cost.

## Text-only mode

Press **🙈 Hide** (or `V`) to hide the video. The subtitle panel gets wider and a small player bar appears (play/pause, position, speed). The audio keeps playing. **🎬 Show video** or `V` brings the video back.

## Other things

- **Resume:** the app remembers where you stopped in every video; a thin bar on the video card on the home grid shows your progress.
- **Speed:** 0.75×, 1×, 1.25×, 1.5×; remembered.
- **Delete:** 🗑 on a card on the home grid or in the video view. This deletes the video file and its subtitles from your computer.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | play / pause |
| `←` / `→` | 5 seconds back / forward |
| `↑` / `↓` | previous / next card |
| `V` | hide / show the video |
| `Esc` | close a popup, the video list or a dialog |
| `Space`, `1`–`4` | in Review: reveal, then rate |
| `M`, `Space`, `L`, `1`/`2`, `←`/`→` | in Study (one by one): speak, show, listen, mark, move |

## Changing the translation language

Open **⚙ Settings → Translate subtitles into**. Videos translated into another language show a bar at the top: *“This video is translated into … but your language is …”* with a button to translate it into the new one. Translations are stored per video; a new translation replaces the old one.

## Where is my data?

In the `data/` folder of the project (one folder per video: the video, `project.json` with the cards and translations, and `words.json` with word timings). Back it up by copying the folder; moving it to another computer works too. See [CONFIGURATION.md](CONFIGURATION.md).
