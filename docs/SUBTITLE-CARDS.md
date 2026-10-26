# Subtitle cards: sentences are never split

The subtitle panel is made of **cards**. A card holds one or a few **whole sentences**; a sentence never spans two cards. This page explains how cards and their timings are made and how to tune them.

## Why not use Whisper's own segments?

Whisper cuts speech into segments without looking at sentence boundaries, so a segment often ends with the first half of a sentence and starts with the second half of another. That hurts reading, and it ruins translation: half a sentence is translated as if it were a whole one. So this app asks Whisper for **word-level timestamps** and builds the cards itself.

## The pipeline

```
video.mp4 ──ffmpeg──► 16 kHz WAV ──whisper-cli -ml 1 -sow -mc 0──► words (each with start/end)
                          └──ffmpeg silencedetect──► silent intervals
words ──► sentences ──► times snapped to the silences ──► cards (greedy packing) ──► project.json
```

Code: [transcribe.js](../transcribe.js) (audio + Whisper), [segmenter.js](../segmenter.js) (sentences, times, cards), [exec.js](../exec.js) (running commands). The unit tests in `test/segmenter.test.js` check, among others, that no sentence is ever split or lost and that cards never overlap.

### 1) Word timestamps

`whisper-cli -ml 1 -sow -mc 0` returns one entry per word. The result is saved in `data/<id>/words.json`, so you can change the card settings later without running Whisper again.

`-mc 0` (do not condition on the previous text) matters: with it enabled Whisper sometimes drifts into lower-case text without punctuation for the rest of the recording (measured on one video: 12 sentence ends in 2807 words, against 253 with `-mc 0`). Since sentences come from punctuation, that would produce huge cards.

### 2) Sentences

A word ends a sentence when it ends with `.`, `?`, `!` or `…` (optionally followed by quotes or brackets). Exceptions: abbreviations such as `Dr.`, `Mr.`, `e.g.`, `p.m.` and single-letter initials (`J.`) do not end a sentence, and an ellipsis (`...`/`…`) ends one only when the next word starts with a capital letter.

### 3) Accurate timing: snapping to silences

Whisper adds the pause between sentences to the previous word, so the reported end of a sentence is typically **0.4–1.5 seconds too late** (measured). Cards would start in the middle of silence and end late. Therefore:

- `ffmpeg silencedetect` finds the silent intervals. The threshold adapts to the recording (`average volume − 6 dB`, limited to −45…−26 dB; minimum silence 0.1 s).
- Between two sentences the **longest silence that starts inside the last word** is used: the sentence ends where the silence starts and the next one begins where it ends. Without a silence (fast speech) Whisper's time is kept.
- A small padding is added: **0.12 s** before and **0.18 s** after the speech. If the silence is shorter than both pads together, it is split in the middle. Neighbouring cards therefore never overlap.

The result: when you repeat a card with 🔁 the first word is not clipped and the next sentence does not leak in.

### 4) Packing sentences into cards

Sentences are added to a card in order, as long as **all** of these hold:

| Setting (`CARD` in `segmenter.js`) | Default | Meaning |
|---|---|---|
| `maxSentences` | 3 | most sentences in one card |
| `maxChars` | 120 | most characters of a merged card |
| `maxGap` | 2.0 s | start a new card if the silence between sentences is longer |
| `maxDuration` | 10 s | a merged card never runs longer |
| `startPad` / `endPad` | 0.12 / 0.18 s | padding around speech |

A single sentence that is longer than these limits **keeps its own card and is not split**, up to 32 words (`maxSentenceWords`). Above that it is a comma-chained run-on (speakers sometimes string 70–100 words together with commas) and is cut at the best clause boundary: a comma, preferably followed by a pause (`clausePause`, 0.5 s), into pieces of about 16 words (`targetClauseWords`, between 8 and 28). Each piece is a sentence of its own for colours, translation and Study; a normal sentence is never cut.

Each card is stored as `{ start, end, text, sents: [sentence, …], sentTimes: [[start, end], …] }`. `sents` is the exact sentence list used for colours and for translation; `sentTimes` gives every sentence its own padded, non-overlapping time range, so a single sentence can be saved to favorites and played on its own.

## Recordings without punctuation

Some recordings come out without punctuation even with `-mc 0` (or the speaker recites without pauses). Two safety nets exist:

- **Pause mode.** If a video has fewer than one sentence end per 40 words (`minPunctDensity`), sentence boundaries are taken from pauses of at least 0.35 s (`pauseBreak`), with at least 5 words per sentence (`minSentenceWords`). Well-punctuated videos are never affected. `npm run regroup` prints a warning when it switches to this mode.
- **Long unpunctuated runs.** A "sentence" longer than 200 characters (`maxUnpunctuated`) **without any comma, semicolon or colon** is considered unpunctuated speech and is split at pauses. Sentences *with* commas are split only when they exceed 32 words (see above).

Continuous recitation without pauses (for example a chanted prayer) cannot be split and may stay one long card.

## Rebuilding cards: `npm run regroup`

New videos use this pipeline automatically. To rebuild existing videos or apply new settings:

```bash
npm run regroup -- all                 # all videos; reuses words.json, so Whisper does not run again (seconds)
npm run regroup -- <video-id>          # one video (the id is the folder name in data/)
npm run regroup -- all --whisper       # transcribe again with word timestamps (about 1–5 min per video)
npm run regroup -- all --no-translate  # do not translate afterwards
```

- The first time, the previous version of `project.json` is saved as `data/<id>/segments.whisper.json` (your way back; never overwritten later).
- Translations of cards whose text did not change are **kept**; only new or changed cards are translated (the script asks the running app; if it is not running, open the app and press **Translate**).
- Speed: about 8–11× real time on Apple silicon with `medium.en` (a 5.8-minute video takes ~30 s, a 19-minute one ~65 s).

### Tuning

1. Edit the `CARD` values in `segmenter.js`.
2. Run `npm run regroup -- all` (no Whisper run needed).

## Files

| File | Content |
|---|---|
| `data/<id>/project.json` | cards (`segments`), translations (`tr`, `trParts`, `trLang`) |
| `data/<id>/words.json` | word timings and the silence map (for rebuilding cards) |
| `data/<id>/segments.whisper.json` | backup made by `regroup` (only for videos that were regrouped) |
