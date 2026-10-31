import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { ENGLISH, language, languageOf, setLanguage, t, TABLES } from '../src/i18n';
import { applyInitiative, turnAnnouncement, type InitiativeEntry, type InitiativeState } from '../src/board/initiative';

// Atlas has no translations, so Tabletop ships none: the layer is tested with a stand-in language added for the test.
beforeEach(() => {
  TABLES.xx = { 'group.selected': '{n} chosen', 'open3d': 'Open (xx)', 'turn.banner': 'Turn {round} / {names}' };
});
afterEach(() => {
  delete TABLES.xx;
  setLanguage('en');
});

test('no language is shipped: every code is English until a table exists', () => {
  delete TABLES.xx;
  for (const code of ['en', 'pt', 'pt-BR', 'fr', 'zh-TW', '', null, undefined]) assert.equal(languageOf(code), 'en', String(code));
  assert.deepEqual(Object.keys(TABLES), []);
});

test("Obsidian's language codes map to a table, or to English", () => {
  assert.equal(languageOf('xx'), 'xx');
  assert.equal(languageOf('XX-yy'), 'xx');
  assert.equal(languageOf('xx_YY'), 'xx');
  for (const other of ['en', 'en-GB', 'fr', '', null, undefined]) assert.equal(languageOf(other), 'en', String(other));
});

test('a string is in the current language, {values} are filled, and a missing translation shows in English', () => {
  assert.equal(t('group.selected', { n: 3 }), '3 selected');
  setLanguage('xx-YY');
  assert.equal(language(), 'xx');
  assert.equal(t('group.selected', { n: 3 }), '3 chosen');
  assert.equal(t('open3d'), 'Open (xx)');
  assert.equal(t('group.rotateLeft', { deg: 45 }), 'Rotate left 45\u00b0', 'untranslated: English');
  setLanguage('fr');
  assert.equal(t('open3d'), 'Open in 3D');
  assert.equal(t('group.selected'), '{n} selected', 'a value not given leaves its placeholder');
});

test('every translation has an English original, and keeps its placeholders', () => {
  const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
  for (const [code, table] of Object.entries(TABLES)) {
    for (const [key, text] of Object.entries(table)) {
      assert.ok(key in ENGLISH, `${code}: ${key} has no English original`);
      assert.deepEqual(placeholders(text as string), placeholders(ENGLISH[key as keyof typeof ENGLISH]), `${code}: ${key} changes its placeholders`);
    }
  }
});

test('the turn banner speaks the language', () => {
  const entry = (id: string, order: number): InitiativeEntry => ({ id, tokenId: `t-${id}`, name: id, initiative: 0, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order });
  const state: InitiativeState = { entries: [entry('Goblin', 0)], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } };
  const started = applyInitiative(state, { type: 'start', rules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' } }, () => 0.5);
  assert.equal(turnAnnouncement(started)!.text, 'Round 1 \u00b7 Goblin');
  setLanguage('xx');
  assert.equal(turnAnnouncement(started)!.text, 'Turn 1 / Goblin');
});
