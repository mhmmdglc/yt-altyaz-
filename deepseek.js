// DeepSeek client (OpenAI-compatible chat completions with JSON mode). Used as a fallback when Gemini's quota is used up.
// Docs: docs/AI.md → "DeepSeek fallback"
import { AIError } from './gemini.js';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
const base = () => (process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');

// A small example object built from a (Gemini-style) schema: DeepSeek's JSON mode follows an example shown in the prompt
export function schemaExample(schema) {
  const type = String(schema?.type || '').toUpperCase();
  if (type === 'OBJECT') {
    const keys = schema.propertyOrdering || Object.keys(schema.properties || {});
    return Object.fromEntries(keys.map((k) => [k, schemaExample(schema.properties[k])]));
  }
  if (type === 'ARRAY') return [schemaExample(schema.items)];
  if (type === 'INTEGER' || type === 'NUMBER') return 0;
  if (type === 'BOOLEAN') return false;
  return '…';
}

export async function deepseekJSON({ apiKey, model = DEFAULT_DEEPSEEK_MODEL, prompt, schema, temperature = 0.7 }) {
  if (!apiKey) throw new AIError('NO_AI_KEY', 'No DeepSeek API key is configured.', 409);
  const system = `Answer with one json object only, no other text. Use exactly this structure (types shown by the example values):\n${JSON.stringify(schemaExample(schema))}`;
  const call = async () => {
    let res;
    try {
      res = await fetch(`${base()}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
        }),
        signal: AbortSignal.timeout(90_000)
      });
    } catch (e) {
      throw new AIError('AI_OFFLINE', `Could not reach DeepSeek: ${e.message}`, 503);
    }
    const text = await res.text();
    if (!res.ok) {
      const message = (() => { try { return JSON.parse(text).error?.message || text; } catch { return text; } })().slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new AIError('AI_KEY_INVALID', `DeepSeek: ${message}`, 401);
      if (res.status === 402 || res.status === 429) throw new AIError('AI_QUOTA', `DeepSeek: ${message}`, 429); // 402 = balance used up
      if (res.status === 404 || /model/i.test(message)) throw new AIError('AI_MODEL', `DeepSeek model "${model}": ${message}`, 400);
      throw new AIError('AI_FAILED', `DeepSeek error ${res.status}: ${message}`);
    }
    return String(JSON.parse(text).choices?.[0]?.message?.content ?? '').trim();
  };
  // JSON mode may occasionally return empty content (documented); one retry
  let content = await call();
  if (!content) content = await call();
  try {
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new AIError('AI_FAILED', 'DeepSeek returned an answer that is not valid JSON.');
  }
}
