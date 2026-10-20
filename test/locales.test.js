import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, LOCALE_NAMES } from '../public/locales.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

// Plural categories (.one, .few, …) are language-specific; only the required .other form has to exist everywhere
const isExtraPlural = (key) => /\.(zero|one|two|few|many)$/.test(key);
const baseKeys = (dict) => Object.keys(dict).filter((k) => !isExtraPlural(k)).sort();

test('every interface language has the same keys as English (plural extras aside)', () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    assert.deepEqual(baseKeys(dict), baseKeys(LOCALES.en), `${code} keys differ from en`);
    assert.ok(LOCALE_NAMES[code], `${code} needs an entry in LOCALE_NAMES`);
  }
});

test('placeholders match between languages', () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    for (const key of baseKeys(LOCALES.en)) {
      assert.equal(placeholders(dict[key]), placeholders(LOCALES.en[key]), `${code}: placeholders of "${key}" differ`);
    }
  }
});

test('no empty translations', () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(dict)) assert.ok(value.trim(), `${code}: "${key}" is empty`);
  }
});
