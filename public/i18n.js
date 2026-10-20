// Minimal i18n: t('key', { vars }) plus data-i18n* attributes in index.html. Dictionaries live in locales.js.
import { LOCALES, LOCALE_NAMES } from './locales.js';

const KEY = 'uiLang';

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LOCALES[saved]) return saved;
  } catch { /* storage unavailable */ }
  const wanted = (navigator.languages || [navigator.language || 'en']).map((l) => l.toLowerCase().split('-')[0]);
  return wanted.find((l) => LOCALES[l]) || 'en';
}

let lang = detect();

export const getLang = () => lang;
export const localeOptions = () => Object.keys(LOCALES).map((code) => ({ code, name: LOCALE_NAMES[code] || code }));

export function t(key, vars = {}) {
  const text = LOCALES[lang][key] ?? LOCALES.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ''));
}

// Plural-aware lookup: tn('home.count', 3) uses home.count.one / .few / .other as the language requires
export function tn(key, n, vars = {}) {
  const category = new Intl.PluralRules(lang).select(n);
  const dict = LOCALES[lang];
  const chosen = dict[`${key}.${category}`] !== undefined ? `${key}.${category}` : `${key}.other`;
  return t(chosen, { n, ...vars });
}

// Fills every [data-i18n], [data-i18n-html], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria] element
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.documentElement.lang = lang;
}

export function setLang(code) {
  if (!LOCALES[code]) return;
  lang = code;
  try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
  applyI18n();
}

// Display name of a language code in the current interface language (falls back to the English name from the server)
export function languageName(code, fallback = code) {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'language' }).of(code);
    return name && name !== code ? name : fallback; // some browsers do not know every code and echo it back
  } catch { return fallback; }
}
