// Chooses the AI provider for each request: Gemini first; if it fails (most often: the quota is used up) and a DeepSeek
// key is configured, the same request goes to DeepSeek at once. After a quota error Gemini is skipped for a while.
import { generateJSON, AIError } from './gemini.js';
import { deepseekJSON } from './deepseek.js';

export const GEMINI_COOLDOWN_MS = 15 * 60 * 1000;
let geminiPausedUntil = 0;

export const geminiPaused = (now = Date.now()) => geminiPausedUntil > now;
export const resetCooldown = () => { geminiPausedUntil = 0; };

// cfg: { gemini: { apiKey, model }, deepseek: { apiKey, model }, prefer?: 'gemini' | 'deepseek' }
// Returns { generate, used } — `generate({ prompt, schema, temperature })` and, after a call, `used.provider`.
export function router(cfg) {
  const used = { provider: null };
  const providers = {
    gemini: (args) => generateJSON({ apiKey: cfg.gemini.apiKey, model: cfg.gemini.model, ...args }),
    deepseek: (args) => deepseekJSON({ apiKey: cfg.deepseek.apiKey, model: cfg.deepseek.model, ...args })
  };

  async function generate(args) {
    const order = cfg.prefer ? [cfg.prefer] : ['gemini', 'deepseek'];
    const available = order.filter((p) => cfg[p]?.apiKey && !(p === 'gemini' && !cfg.prefer && geminiPaused() && cfg.deepseek?.apiKey));
    if (!available.length) throw new AIError('NO_AI_KEY', 'No AI API key is configured.', 409);
    let lastError;
    for (const name of available) {
      try {
        const out = await providers[name](args);
        used.provider = name;
        return out;
      } catch (e) {
        lastError = e;
        if (name === 'gemini' && e.code === 'AI_QUOTA') geminiPausedUntil = Date.now() + GEMINI_COOLDOWN_MS;
        if (!(e instanceof AIError)) throw e;
        // try the next provider, if there is one
      }
    }
    throw lastError;
  }

  return { generate, used };
}
