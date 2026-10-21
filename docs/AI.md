# AI features (optional): Gemini

With an API key, **✨ Vary** uses Google's **Gemini API**: the grammar pattern of a sentence, a short explanation in your language, and new example sentences in the same pattern at your level, plus real sentences with the same pattern from your own videos.

Everything else stays on your computer: videos are still translated by the local model (HY-MT), and clicked words are still translated by it too.

**Optional:** *Settings → Also use Gemini for word meanings* (off by default) asks Gemini for the meaning of a clicked word *in its sentence*, with the dictionary form and part of speech, instead of translating the word on its own. It is more accurate for words with several meanings, but it sends that sentence to Google; if Gemini fails, the local model is used.

## Add a key

1. Create a free key in Google AI Studio: <https://aistudio.google.com/apikey>.
2. In the app open **⚙ Settings → AI features**, paste the key, press **Save**, then **Test**.

Or put it in a `.env` file in the project folder (copy `.env.example`), which also works for desktop shortcuts:

```bash
GEMINI_API_KEY=your-key
```

An environment variable (`GEMINI_API_KEY=your-key npm start`) or the `.env` file takes precedence over a key saved in Settings. `.env` is ignored by git.

A key saved in Settings is stored in `data/settings.json` on your computer (that folder is never committed to git). It is **never sent to the browser**: the interface only sees its last four characters.

## Level

Choose your English level (A2, B1, B2, C1; default B1) in the top bar or in Settings. Explanations and example sentences are written for that level.

## What is sent to Google

| Action | Sent | Not sent |
|---|---|---|
| ✨ Vary | the sentence, the sentence before it (for context), your translation language and level, and the examples already shown (when you ask for more) | the video, the audio, other subtitles, your library, your favorites |
| Click a word (only with *Gemini for word meanings* on) | the word, the sentence it is in, your translation language and level | everything else |

Real examples from your library are found **on your computer**: Gemini only suggests a few search phrases (such as "good at"), the search runs locally.

**Free and paid tiers.** According to Google's pricing page (checked October 2026), on the **free tier** "content [is] used to improve our products", on the **paid tier** it is not. Do not send sentences you would not want Google to see, and use a paid key if this matters to you. Check the current terms: <https://ai.google.dev/gemini-api/docs/pricing>.

## Cost

The free tier has rate limits; when they are reached the app says so and you can try again later. On the paid tier, the default model was priced at **$0.30 per million input tokens and $2.50 per million output tokens** (October 2026). One Vary request uses roughly 400 input and 300–400 output tokens, so about **$0.001**: around a dollar for a thousand requests. Prices change; see the pricing page.

Every answer is **cached** in `data/ai-cache.json`, so opening the same sentence again costs nothing. **＋ More examples** always makes a new request.

## Model

The default is **`gemini-3.5-flash-lite`**, Google's fastest and cheapest current model (recommended for new projects in October 2026). To use another one, type its id in **Settings → Model** or set `GEMINI_MODEL`, for example `gemini-3.8-flash` for higher quality at a higher price. Model ids: <https://ai.google.dev/gemini-api/docs/models>.

The app calls the `generateContent` endpoint and asks for JSON that follows a schema; if a model rejects the schema, it retries without it.

## Quality

Gemini writes good, natural examples, but explanations can occasionally be wrong or oversimplified, and the "pattern" it picks may not be the one you were curious about. The panel says *Made by AI*. Treat it as a study aid.

## Troubleshooting

| Message | What to do |
|---|---|
| "Gemini did not accept the API key" | Check the key in Settings (no spaces), or create a new one. |
| "The Gemini quota is used up for now" | Free-tier limit reached: wait a little, or use a paid key. Word meanings fall back to the local model meanwhile (if it is installed). |
| "Gemini could not be reached" | Check your internet connection. |
| "This Gemini model is not available" | The model id in Settings is wrong or retired: clear it to use the default. |

## For developers

`gemini.js` contains the prompts and the response schemas; `ai-cache.js` the cache. `GEMINI_API_BASE` points the app at another endpoint (the tests use a local fake server). The prompts are in English and ask for the explanation and translations in the user's language.
