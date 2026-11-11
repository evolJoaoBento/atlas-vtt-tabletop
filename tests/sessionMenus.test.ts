import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MenuEntry } from '../src/board/atlasMenu';
import { playersSeeEntry, presentToEntry } from '../src/board/sessionMenus';
import type { BoardPresentTo, BoardResourceShows } from '../src/connectContract';

const children = (entry: MenuEntry | null | undefined): MenuEntry[] => (entry?.type === 'submenu' ? entry.children() : []);
const items = (entries: MenuEntry[]) => entries.map((entry) => (entry.type === 'item' ? [entry.label, entry.checked === true, entry.disabled === true] : [entry.type]));
const click = (entries: MenuEntry[], label: string): void => {
  const entry = entries.find((each) => each.type === 'item' && each.label === label);
  if (entry?.type === 'item') entry.onClick();
};

test('a scene tab\'s Present to: Connect\'s rows, ticked and kept open, then Everyone back; none without a session', () => {
  let menu: BoardPresentTo = {
    heading: 'Present to', noPlayers: 'No players connected', capNote: null, everyoneBack: { label: 'Everyone back to the presented scene', disabled: true },
    rows: [{ playerId: 'm', label: 'Mara · on Hall', checked: false, disabled: false }, { playerId: 'k', label: 'Kestrel · on Hall', checked: false, disabled: false }],
  };
  const chosen: string[] = [];
  const entry = presentToEntry(() => menu, (id) => {
    chosen.push(id);
    menu = { ...menu, rows: menu.rows.map((row) => (row.playerId === id ? { ...row, label: 'Mara', checked: true } : row)), everyoneBack: { ...menu.everyoneBack, disabled: false } };
  }, () => chosen.push('back'));
  assert.equal(entry?.type === 'submenu' && entry.label, 'Present to');
  assert.deepEqual(items(children(entry)), [['Mara · on Hall', false, false], ['Kestrel · on Hall', false, false], ['separator'], ['Everyone back to the presented scene', false, true]]);
  const rows = children(entry);
  assert.equal(rows[0]?.type === 'item' && rows[0].keepOpen, true);
  click(rows, 'Mara · on Hall');
  assert.deepEqual(items(children(entry)).slice(0, 1), [['Mara', true, false]]);
  click(children(entry), 'Everyone back to the presented scene');
  assert.deepEqual(chosen, ['m', 'back']);
  menu = { ...menu, rows: [], capNote: 'At most 4 scenes at once' };
  assert.deepEqual(items(children(entry)).slice(0, 2), [['At most 4 scenes at once', false, true], ['No players connected', false, true]]);
  assert.equal(presentToEntry(() => null, () => undefined, () => undefined), null);
});

test('a token\'s Players see: a submenu per resource, each column under its heading, the choice in force ticked', () => {
  const options = [{ value: '', label: 'Same as every Goblin' }, { value: 'both', label: 'Bar and numbers' }, { value: 'bar', label: 'Bar only' }, { value: 'hidden', label: 'Hidden' }];
  let shows: BoardResourceShows = {
    title: 'Players see', columns: ['This token', 'Every Goblin'],
    rows: [{ label: 'HP', choices: [
      { id: 'token:hp', label: 'HP, this token', value: '', options },
      { id: 'statblock:hp', label: 'HP, every goblin', value: 'bar', options: [{ value: '', label: 'Map default (shown)' }, ...options.slice(1)] },
    ] }],
  };
  const set: Array<[string, string]> = [];
  const entry = playersSeeEntry(() => shows, (id, value) => {
    set.push([id, value]);
    shows = { ...shows, rows: [{ ...shows.rows[0]!, choices: shows.rows[0]!.choices.map((choice) => (choice.id === id ? { ...choice, value } : choice)) }] };
  });
  assert.equal(entry?.type === 'submenu' && entry.label, 'Players see');
  const hp = children(entry)[0];
  assert.equal(hp?.type === 'submenu' && hp.label, 'HP');
  assert.deepEqual(items(children(hp)), [
    ['This token', false, true], ['Same as every Goblin', true, false], ['Bar and numbers', false, false], ['Bar only', false, false], ['Hidden', false, false],
    ['separator'],
    ['Every Goblin', false, true], ['Map default (shown)', false, false], ['Bar and numbers', false, false], ['Bar only', true, false], ['Hidden', false, false],
  ]);
  click(children(hp), 'Hidden');
  assert.deepEqual(set, [['token:hp', 'hidden']]);
  assert.ok(children(hp).some((each) => each.type === 'item' && each.label === 'Hidden' && each.checked === true));
  // The choice in force chosen again changes nothing.
  click(children(hp), 'Hidden');
  assert.equal(set.length, 1);
  assert.equal(playersSeeEntry(() => null, () => undefined), null);
});
