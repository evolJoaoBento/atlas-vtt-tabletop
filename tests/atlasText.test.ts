import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { at, ATLAS_LANGUAGES, ATLAS_TEXT } from '../src/atlasPort/atlasText';
import { ATLAS_TEXT_KEYS } from '../src/atlasPort/atlasTextKeys';
import { setLanguage } from '../src/i18n';

afterEach(() => setLanguage('en'));

test("Atlas's own English wording", () => {
  assert.equal(at('toolbarEdit.assets.label'), 'Asset manager');
  assert.equal(at('toolbarEdit.palette.label'), 'Command palette');
});

test("follows Obsidian's language where Atlas has it", () => {
  setLanguage('ru');
  assert.notEqual(at('toolbarEdit.assets.label'), 'Asset manager');
  assert.equal(at('toolbarEdit.assets.label'), ATLAS_TEXT.ru['toolbarEdit.assets.label']);
  setLanguage('zh-TW');
  assert.equal(at('hotkey.assets'), ATLAS_TEXT.zh['hotkey.assets']);
  assert.notEqual(at('hotkey.assets'), ATLAS_TEXT.en['hotkey.assets']);
  // A text Atlas has not translated is English, as in Atlas.
  assert.equal(ATLAS_TEXT.zh['toolbarEdit.assets.label'], undefined);
  assert.equal(at('toolbarEdit.assets.label'), 'Asset manager');
});

test('a language Atlas lacks is English', () => {
  setLanguage('pt-BR');
  assert.equal(at('toolbarEdit.assets.label'), 'Asset manager');
});

test('fills placeholders and picks plural forms as Atlas does', () => {
  assert.equal(at('test.placeholder' as never, { name: 'x' }), 'test.placeholder');
  const plural = ATLAS_TEXT_KEYS.find((key) => typeof ATLAS_TEXT.en[key] === 'object');
  if (plural) assert.notEqual(at(plural, { count: 1 }), at(plural, { count: 5 }));
});

test('every key Tabletop uses is in Atlas\'s English table', () => {
  assert.deepEqual(ATLAS_LANGUAGES, ['en', 'ru', 'zh']);
  for (const key of ATLAS_TEXT_KEYS) assert.ok(ATLAS_TEXT.en[key] !== undefined, key);
});
