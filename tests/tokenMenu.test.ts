import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenMenuEntries, type TokenMenuContext } from '../src/board/tokenMenu';
import type { MenuEntry } from '../src/board/atlasMenu';
import type { BoardToken } from '../src/board/mapModel';

function menu(kind: 'character' | 'token', controllers: TokenMenuContext['controllers'], record: unknown[] = [], ask?: { asked: boolean }, seeing = false): MenuEntry[] {
  const token = { id: 't1', kind, name: 'Hero', hidden: false, conditions: [], conditionValues: {}, resources: {} } as unknown as BoardToken;
  const nothing = (): void => undefined;
  return tokenMenuEntries({
    token: () => token,
    rules: { conditions: new Map(), definitions: [] } as unknown as TokenMenuContext['rules'],
    settings: () => ({ showNameplates: true, showInstanceBadges: true, hiddenResources: [] }),
    seeing: () => seeing,
    inInitiative: () => false, hasMini: () => false, miniBase: () => 'none', standee: () => false, lightHeight: () => null,
    ...(controllers ? { controllers } : {}),
    ...(ask ? { spellAsked: () => ask.asked } : {}),
    icon: nothing,
    actions: {
      setCondition: nothing, stepCondition: nothing, setHidden: nothing, setInitiative: nothing, assignMini: nothing, removeMini: nothing,
      setBase: nothing, setStandee: nothing, setLightHeight: nothing, reset: nothing, kill: nothing, remove: nothing,
      setController: (playerId, controls) => { record.push([playerId, controls]); },
      ...(ask ? { askSpell: () => { record.push('ask'); } } : {}),
      seeThrough: (on) => { record.push(['eyes', on]); },
      castSelf: () => { record.push('self'); },
    },
  });
}

const children = (entry: MenuEntry | undefined): MenuEntry[] => (entry && entry.type === 'submenu' ? entry.children() : []);

test('Controlled by: while Connect hosts, a character lists the players, ticked as they control it, and a pick toggles', () => {
  const record: unknown[] = [];
  const entries = menu('character', () => [{ playerId: 'anna', name: 'Anna', controls: true }, { playerId: 'ben', name: 'Ben', controls: false }], record);
  const controlled = entries.find((entry) => entry.type === 'submenu' && entry.label === 'Controlled by');
  const items = children(controlled);
  assert.deepEqual(items.map((item) => item.type === 'item' ? [item.label, item.checked, item.keepOpen] : null), [['Anna', true, true], ['Ben', false, true]]);
  for (const item of items) if (item.type === 'item') item.onClick();
  assert.deepEqual(record, [['anna', false], ['ben', true]]);
});

test('Controlled by: no players yet says so; no session, or a plain token, has no such menu', () => {
  const empty = children(menu('character', () => []).find((entry) => entry.type === 'submenu' && entry.label === 'Controlled by'));
  assert.equal(empty.length, 1);
  assert.equal(empty[0]?.type === 'item' && empty[0].disabled, true);
  assert.equal(menu('character', () => null).some((entry) => entry.type === 'submenu' && entry.label === 'Controlled by'), false);
  assert.equal(menu('character', undefined).some((entry) => entry.type === 'submenu' && entry.label === 'Controlled by'), false);
  assert.equal(menu('token', () => []).some((entry) => entry.type === 'submenu' && entry.label === 'Controlled by'), false);
});

test('Cast: a token a player controls offers Myself and Player (saying when an ask waits); else Cast is Myself alone', () => {
  const record: unknown[] = [];
  const anna = () => [{ playerId: 'anna', name: 'Anna', controls: true }];
  const cast = menu('character', anna, record, { asked: false }).find((each) => each.type === 'submenu' && each.label === 'Cast');
  const items = children(cast);
  assert.deepEqual(items.map((item) => (item.type === 'item' ? item.label : null)), ['Myself', 'Player: Anna…']);
  for (const item of items) if (item.type === 'item') item.onClick();
  assert.deepEqual(record, ['self', 'ask']);
  assert.ok(children(menu('character', anna, [], { asked: true }).find((each) => each.type === 'submenu' && each.label === 'Cast'))
    .some((item) => item.type === 'item' && item.label === 'Player: Anna (asked)…'));
  // Nobody controls it, or no Connect: Cast goes through its eyes at once.
  const nobody = () => [{ playerId: 'anna', name: 'Anna', controls: false }];
  for (const entries of [menu('character', nobody, [], { asked: false }), menu('character', anna), menu('token', undefined)]) {
    assert.ok(entries.some((each) => each.type === 'item' && each.label === 'Cast'));
    assert.equal(entries.some((each) => each.type === 'submenu' && each.label === 'Cast'), false);
  }
  // The old entries are gone.
  assert.equal(menu('character', anna, [], { asked: false }).some((each) => each.type === 'item' && /Ask for a spell|See through its eyes/.test(each.label)), false);
});

test('Cast with no player goes into the eyes with the search; in them, Leave its eyes', () => {
  const record: unknown[] = [];
  const entry = menu('token', undefined, record).find((each) => each.type === 'item' && each.label === 'Cast');
  assert.ok(entry && entry.type === 'item');
  entry.onClick();
  assert.deepEqual(record, ['self']);
  const inside: unknown[] = [];
  const leave = menu('token', undefined, inside, undefined, true).find((each) => each.type === 'item' && each.label === 'Leave its eyes');
  assert.ok(leave && leave.type === 'item');
  leave.onClick();
  assert.deepEqual(inside, [['eyes', false]]);
});

test('Players see: while Connect offers the choice, the token menu has it next to Controlled by; without it, not', () => {
  const token = { id: 't1', kind: 'character', name: 'Goblin', hidden: false, conditions: [], conditionValues: {}, resources: {} } as unknown as BoardToken;
  const nothing = (): void => undefined;
  const set: Array<[string, string]> = [];
  const build = (shows: TokenMenuContext['resourceShows']): MenuEntry[] => tokenMenuEntries({
    token: () => token,
    rules: { conditions: new Map(), definitions: [] } as unknown as TokenMenuContext['rules'],
    settings: () => ({ showNameplates: true, showInstanceBadges: true, hiddenResources: [] }),
    inInitiative: () => false, hasMini: () => false, miniBase: () => 'none', standee: () => false, lightHeight: () => null,
    ...(shows ? { resourceShows: shows } : {}),
    icon: nothing,
    actions: {
      setCondition: nothing, stepCondition: nothing, setHidden: nothing, setInitiative: nothing, assignMini: nothing, removeMini: nothing,
      setBase: nothing, setStandee: nothing, setLightHeight: nothing, reset: nothing, kill: nothing, remove: nothing,
      setResourceShow: (id, value) => { set.push([id, value]); },
    },
  });
  const options = [{ value: '', label: 'Map default (shown)' }, { value: 'bar', label: 'Bar only' }, { value: 'hidden', label: 'Hidden' }];
  const entries = build(() => ({ title: 'Players see', columns: ['This token'], rows: [{ label: 'HP', choices: [{ id: 'token:hp', label: 'HP, this token', value: '', options }] }] }));
  const hp = children(children(entries.find((entry) => entry.type === 'submenu' && entry.label === 'Players see'))[0]);
  assert.deepEqual(hp.map((item) => (item.type === 'item' ? [item.label, item.checked] : null)), [['Map default (shown)', true], ['Bar only', false], ['Hidden', false]]);
  const bar = hp[1];
  if (bar?.type === 'item') bar.onClick();
  assert.deepEqual(set, [['token:hp', 'bar']]);
  assert.equal(build(() => null).some((entry) => entry.type === 'submenu' && entry.label === 'Players see'), false);
  assert.equal(build(undefined).some((entry) => entry.type === 'submenu' && entry.label === 'Players see'), false);
});
