import assert from 'node:assert/strict';
import { test } from 'node:test';
// The board's turn banner is Atlas 0.18's (`initiative/banner`, copied under src/atlasPort): what these tests play is the board's
// wiring of it (`turnBanner.ts`) and the words and colours the copies give.
import { turnBannerOf } from '../src/atlasPort/app/initiative/banner/turnBanner';
import { setLanguage } from '../src/i18n';
import { setAtlasLanguage } from '../src/atlasPort/atlasText';
import { bannerStateOf, TurnAnnouncer, turnBannerEnabled, type TurnBannerState } from '../src/board/turnBanner';
import type { BoardToken } from '../src/board/mapModel';
import { readInitiative, type InitiativeState } from '../src/board/initiative';

const token = (id: string, fields: Partial<BoardToken> = {}): BoardToken => ({
  id, x: 0, y: 0, size: 1, rotation: 0, imagePath: null, kind: 'character', name: id, hidden: false, showRing: true, ringColor: '#ff0000', showNameplate: false,
  conditions: [], conditionValues: {}, resources: {}, overriddenMax: [], statblockPath: null, levelId: null, ...fields,
} as unknown as BoardToken);
const entry = (id: string, order: number, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `e-${id}`, tokenId: id, name: id.toUpperCase(), initiative: 10 - order, initiativeModifier: 0, imagePath: `${id}.png`, isActive: false, isNPC: true, order, ...fields,
});
const fight = (turn: number, round = 1, fields: Record<string, unknown> = {}, entries: Array<Record<string, unknown>> = [entry('a', 0), entry('b', 1), entry('c', 2)]): InitiativeState =>
  readInitiative({ entries: entries.map((one, index) => ({ ...one, isActive: index === turn })), currentIndex: turn, round, isActive: true, config: { autoSort: true }, ...fields });
const tokens = [token('a'), token('b'), token('c')];
const stateOf = (initiative: InitiativeState | null, path = 'map.atlasmap'): TurnBannerState => bannerStateOf(path, initiative, tokens);

test('the board says nothing as it opens in a fight, or as a scene loads', () => {
  const announcer = new TurnAnnouncer();
  assert.equal(announcer.look(stateOf(fight(0)), true), null, 'the first look at a running fight');
  assert.equal(announcer.look(stateOf(fight(0)), true), null, 'the same turn again');
  // Another scene: its fight is met afresh, without a banner.
  assert.equal(announcer.look(stateOf(fight(1), 'other.atlasmap'), true), null);
});

test('the turn moving on names whose turn it is, and a new round names the round (Atlas 0.18)', () => {
  const announcer = new TurnAnnouncer();
  announcer.look(stateOf(fight(0)), true);
  const next = announcer.look(stateOf(fight(1)), true);
  assert.ok(next && 'show' in next);
  assert.equal(next.show.length, 1);
  assert.equal(next.show[0]!.title, 'b');
  assert.equal(next.show[0]!.round, null, 'a turn inside the round: "Turn"');
  assert.equal(next.show[0]!.color, '#ff0000', 'the border flashes in the token ring colour');
  assert.deepEqual(next.show[0]!.portrait, { imagePath: 'b.png', showRing: true, ringColor: '#ff0000' });
  const wrapped = announcer.look(stateOf(fight(0, 2)), true);
  assert.ok(wrapped && 'show' in wrapped);
  assert.equal(wrapped.show[0]!.round, 2);
  assert.equal(wrapped.show[0]!.title, 'a');
});

test('the GM\'s setting turns the banner off, and the turn is still followed', () => {
  const announcer = new TurnAnnouncer();
  announcer.look(stateOf(fight(0)), false);
  assert.equal(announcer.look(stateOf(fight(1)), false), null, 'off: nothing shown');
  // Switched on again, the next turn is named (the one now is already seen).
  assert.equal(announcer.look(stateOf(fight(1)), true), null);
  const shown = announcer.look(stateOf(fight(2)), true);
  assert.ok(shown && 'show' in shown);
  assert.equal(shown.show[0]!.title, 'c');
});

test('a fight starting says so and names its first turn; one ending says so', () => {
  const announcer = new TurnAnnouncer();
  announcer.look(stateOf(null), true);
  const started = announcer.look(stateOf(fight(0)), true);
  assert.ok(started && 'show' in started);
  assert.deepEqual(started.show.map((banner) => banner.kind ?? 'turn'), ['fight-start', 'turn']);
  assert.equal(started.show[0]!.title, 'Combat has started');
  assert.equal(started.show[1]!.round, 1);
  const ended = announcer.look(stateOf({ ...fight(0), isActive: false }), true);
  assert.ok(ended && 'show' in ended);
  assert.equal(ended.show[0]!.kind, 'fight-end');
  assert.equal(ended.show[0]!.title, 'Combat has ended');
  // With the setting off a fight's start and end say nothing.
  const quiet = new TurnAnnouncer();
  quiet.look(stateOf(null), false);
  assert.equal(quiet.look(stateOf(fight(0)), false), null);
  assert.deepEqual(quiet.look(stateOf({ ...fight(0), isActive: false }), false), { hideTurn: true });
});

test('a turn banner leaves with the fight, but the end banner stays its time', () => {
  const announcer = new TurnAnnouncer();
  announcer.look(stateOf(fight(0)), true);
  // A fight not running (an Atlas without the fight banner's setting, a tracker emptied): a standing banner hides.
  assert.deepEqual(announcer.look(stateOf({ ...fight(0), isActive: false }), false), { hideTurn: true });
});

test('the GM\'s banner names the hidden combatant and the tokenless one; the players\' look does not name a hidden one', () => {
  const entries = [entry('a', 0), entry('b', 1, { hiddenFromPlayers: true }), entry('p', 2, { tokenId: undefined, partyMemberId: 'm1', name: 'Mira', imagePath: '' })];
  const announcer = new TurnAnnouncer();
  announcer.look(stateOf(fight(0, 1, {}, entries)), true);
  const hidden = announcer.look(stateOf(fight(1, 1, {}, entries)), true);
  assert.ok(hidden && 'show' in hidden);
  assert.equal(hidden.show[0]!.title, 'b', 'the GM sees every turn');
  const party = announcer.look(stateOf(fight(2, 1, {}, entries)), true);
  assert.ok(party && 'show' in party);
  assert.equal(party.show[0]!.title, 'Mira');
  assert.equal(party.show[0]!.portrait, null, 'a combatant without a picture shows its name alone');
  assert.equal(party.show[0]!.color, undefined, 'a combatant without a token flashes in the accent');
  // Atlas's players' banner (the player window, Connect) announces no turn of a combatant the GM hid.
  const state = fight(1, 1, {}, entries);
  const asPlayers = { kind: 'players', showNames: true, mapShowsNameplates: true } as const;
  assert.equal(turnBannerOf(null, state, Object.fromEntries(tokens.map((one) => [one.id, one])) as never, asPlayers), null);
});

test('the setting is Atlas\'s `initiativeTurnOptions().banner`: on unless Atlas says false', () => {
  assert.equal(turnBannerEnabled(null), true, 'without Atlas');
  assert.equal(turnBannerEnabled({}), true, 'an Atlas without the setting');
  assert.equal(turnBannerEnabled({ initiativeTurnOptions: () => ({ banner: true, movesOnTurn: false }) }), true);
  assert.equal(turnBannerEnabled({ initiativeTurnOptions: () => ({ banner: false, movesOnTurn: false }) }), false);
  assert.equal(turnBannerEnabled({ initiativeTurnOptions: () => { throw new Error('gone'); } }), true);
});

test('the banner\'s words are Atlas\'s, in Atlas\'s language', () => {
  setLanguage('ru');
  setAtlasLanguage('ru');
  try {
    const announcer = new TurnAnnouncer();
    announcer.look(stateOf(null), true);
    const started = announcer.look(stateOf(fight(0)), true);
    assert.ok(started && 'show' in started);
    assert.equal(started.show[0]!.title, 'Бой начался');
  } finally {
    setLanguage('en');
    setAtlasLanguage('en');
  }
});

test('the party and tokenless entries of a map file read as Atlas reads them', () => {
  const state = bannerStateOf('m', fight(0), tokens);
  assert.equal(state.mapPath, 'm');
  assert.equal(state.isMapLoading, false);
  assert.deepEqual(Object.keys(state.objects.tokens), ['a', 'b', 'c']);
  assert.equal(bannerStateOf('m', null, tokens).initiative, undefined);
});
