// Translation languages supported by HY-MT1.5 (model card: huggingface.co/tencent/HY-MT1.5-1.8B). The source language is English.
// `name`: the English name the model's prompt template expects. `zh`: the name used in the Chinese templates (Chinese targets only).
export const LANGUAGES = [
  { code: 'zh', name: 'Chinese', zh: '中文' },
  { code: 'zh-Hant', name: 'Traditional Chinese', zh: '繁体中文' },
  { code: 'yue', name: 'Cantonese', zh: '粤语' },
  { code: 'fr', name: 'French' }, { code: 'pt', name: 'Portuguese' }, { code: 'es', name: 'Spanish' },
  { code: 'ja', name: 'Japanese' }, { code: 'tr', name: 'Turkish' }, { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' }, { code: 'ko', name: 'Korean' }, { code: 'th', name: 'Thai' },
  { code: 'it', name: 'Italian' }, { code: 'de', name: 'German' }, { code: 'vi', name: 'Vietnamese' },
  { code: 'ms', name: 'Malay' }, { code: 'id', name: 'Indonesian' }, { code: 'tl', name: 'Filipino' },
  { code: 'hi', name: 'Hindi' }, { code: 'pl', name: 'Polish' }, { code: 'cs', name: 'Czech' },
  { code: 'nl', name: 'Dutch' }, { code: 'km', name: 'Khmer' }, { code: 'my', name: 'Burmese' },
  { code: 'fa', name: 'Persian' }, { code: 'gu', name: 'Gujarati' }, { code: 'ur', name: 'Urdu' },
  { code: 'te', name: 'Telugu' }, { code: 'mr', name: 'Marathi' }, { code: 'he', name: 'Hebrew' },
  { code: 'bn', name: 'Bengali' }, { code: 'ta', name: 'Tamil' }, { code: 'uk', name: 'Ukrainian' },
  { code: 'bo', name: 'Tibetan' }, { code: 'kk', name: 'Kazakh' }, { code: 'mn', name: 'Mongolian' },
  { code: 'ug', name: 'Uyghur' }
];

export const findLanguage = (code) => LANGUAGES.find((l) => l.code === code) || null;
