# AI features (optional): Gemini and DeepSeek

With an API key, **✨ Vary** uses Google's **Gemini API**: the grammar pattern of a sentence, a short explanation in your language, and new example sentences in the same pattern at your level, plus real sentences with the same pattern from your own videos.

It also builds the speaking ladders of **🎯 Study** (see [USAGE.md](USAGE.md#-study-speaking-practice)): Gemini writes the steps; **your voice never goes to Gemini or anywhere else**: it is transcribed by Whisper on your computer, compared word by word, and the recording is deleted right away.

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

## DeepSeek as a fallback

Gemini's free tier runs out quickly. Add a **DeepSeek** key too and the app carries on without stopping:

1. Every AI request goes to Gemini first.
2. If Gemini cannot answer (quota used up, an error, no Gemini key), the same request goes straight to DeepSeek.
3. After a *quota* error the app skips Gemini for **15 minutes** and asks DeepSeek directly, so you do not wait for a failing call each time. Settings shows *⏸ Gemini quota is used up*; pressing **Test** next to Gemini tries it again right away.

Each answer shows a small **Gemini** or **DeepSeek** chip, so you know who wrote it.

Add the key in **⚙ Settings → AI features → DeepSeek**, or in `.env`:

```bash
DEEPSEEK_API_KEY=your-key
```

Keys are created at <https://platform.deepseek.com/api_keys>. DeepSeek has no free tier: you top up a balance and pay per token (see <https://api-docs.deepseek.com/quick_start/pricing>); when the balance is used up it answers with an error and the app reports it. A DeepSeek key alone (without Gemini) also works.

**Privacy.** DeepSeek is a company in China; according to its privacy policy what you send is stored on servers in the People's Republic of China. Only the same things as for Gemini are sent (see the table below), never your voice or your videos.

The app talks to DeepSeek's OpenAI-compatible `chat/completions` endpoint in JSON mode. The default model is `deepseek-flash`; set `DEEPSEEK_MODEL` to use another one, and `DEEPSEEK_BASE_URL` for another compatible endpoint.

## Level

Choose your English level (A2, B1, B2, C1; default B1) in the top bar or in Settings. Explanations and example sentences are written for that level.

## What is sent to Google (or DeepSeek)

| Action | Sent | Not sent |
|---|---|---|
| ✨ Vary | the sentence, the sentence before it (for context), your translation language and level, and the examples already shown (when you ask for more) | the video, the audio, other subtitles, your library, your favorites |
| 🎯 Study | the sentence, the sentence before it, your translation language and level | your voice (transcribed locally), the video, everything else |
| Click a word (only with *Gemini for word meanings* on) | the word, the sentence it is in, your translation language and level | everything else |

Real examples from your library are found **on your computer**: Gemini only suggests a few search phrases (such as "good at"), the search runs locally.

**Free and paid tiers.** According to Google's pricing page (checked October 2026), on the **free tier** "content [is] used to improve our products", on the **paid tier** it is not. Do not send sentences you would not want Google to see, and use a paid key if this matters to you. Check the current terms: <https://ai.google.dev/gemini-api/docs/pricing>.

## Cost

The free tier has rate limits; when they are reached the app says so and you can try again later. On the paid tier, the default model was priced at **$0.30 per million input tokens and $2.50 per million output tokens** (October 2026). One Vary request uses roughly 400 input and 300–400 output tokens, so about **$0.001**: around a dollar for a thousand requests. Prices change; see the pricing page.

Every answer is **cached** in `data/ai-cache.json`, so opening the same sentence again costs nothing. **＋ More examples** and **🔄 New set** always make a new request. A Study ladder (12 steps at B1) is one request of about 400 input and 1,000–1,500 output tokens: about $0.004 on the paid tier.

The default model (`gemini-3.5-flash-lite`) was tested on real sentences: with the current prompt (English first, then its translation) the ladders were correct and consistent and arrived in about 3 seconds. `gemini-3.8-flash` wrote slightly richer ladders but took about 17 seconds and quickly hit the free-tier limit.

## Model

The default is **`gemini-3.5-flash-lite`**, Google's fastest and cheapest current model (recommended for new projects in October 2026). To use another one, type its id in **Settings → Model** or set `GEMINI_MODEL`, for example `gemini-3.8-flash` for higher quality at a higher price. Model ids: <https://ai.google.dev/gemini-api/docs/models>.

The app calls the `generateContent` endpoint and asks for JSON that follows a schema; if a model rejects the schema, it retries without it.

## Quality

Gemini writes good, natural examples, but explanations can occasionally be wrong or oversimplified, and the "pattern" it picks may not be the one you were curious about. The panel says *Made by AI*. Treat it as a study aid.

## Troubleshooting

| Message | What to do |
|---|---|
| "The AI service did not accept the API key" | Check the key in Settings (no spaces), or create a new one. |
| "The AI quota is used up for now" | Gemini's free-tier limit is reached and there is no DeepSeek key (or its balance is used up too): wait a little, add a DeepSeek key, or use a paid key. Word meanings fall back to the local model meanwhile (if it is installed). |
| "The AI service could not be reached" | Check your internet connection. |
| "This AI model is not available" | The model id in Settings (or `DEEPSEEK_MODEL`) is wrong or retired: clear it to use the default. |

## For developers

`gemini.js` contains the prompts, the response schemas and the Gemini client; `deepseek.js` the DeepSeek client (it turns the schema into an example the prompt shows); `ai.js` the router that tries Gemini, falls back to DeepSeek and pauses Gemini after a quota error; `ai-cache.js` the cache. `GEMINI_API_BASE` points the app at another endpoint (the tests use a local fake server). The prompts are in English and ask for the explanation and translations in the user's language.
