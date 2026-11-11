import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { CATALOG, loadSound } from '../src/sound/catalog';

const CONDITIONS = ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'applied'];
const DAMAGE = ['acid', 'bludgeoning', 'cold', 'explosion', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'plain'];
const LOOPS = ['dice.roll', ...DAMAGE.map((d) => `spell.loop.${d}`), 'water.ripples', 'water.flow', 'water.waves', 'water.still'];
const IDS = [
  'dice.hit', 'dice.caught', 'mini.pickup', 'mini.putdown',
  'door.open', 'door.shut', 'door.locked', 'wall.crumble', 'fog.chime', 'turn.horn',
  ...CONDITIONS.map((c) => `condition.${c}`),
  ...DAMAGE.map((d) => `spell.impact.${d}`),
  ...LOOPS,
];

const dir = 'src/assets/sounds';
const catalog = CATALOG as Record<string, (typeof CATALOG)[keyof typeof CATALOG] | undefined>;

test('every sound id is in the catalogue with at least one file', () => {
  for (const id of IDS) {
    const entry = catalog[id];
    assert.ok(entry, `${id} missing`);
    assert.ok(entry.files.length >= 1, `${id} has no file`);
    assert.ok(entry.gain > 0 && entry.gain <= 1, `${id} gain`);
  }
});

test('the catalogue holds no id beyond the listed ones', () => {
  assert.deepEqual(Object.keys(CATALOG).sort(), [...IDS].sort());
});

test('variant counts', () => {
  assert.ok(CATALOG['dice.hit'].files.length >= 6);
  assert.ok(CATALOG['mini.pickup'].files.length >= 4);
  assert.ok(CATALOG['mini.putdown'].files.length >= 4);
});

test('loops are marked as loops, and nothing else is', () => {
  for (const id of IDS) assert.equal(catalog[id]?.loop === true, LOOPS.includes(id), id);
});

test('only the turn horn and the fog chime are not placed', () => {
  for (const id of IDS) assert.equal(catalog[id]?.placed, id !== 'turn.horn' && id !== 'fog.chime', id);
});

test('groups follow the id', () => {
  const expected: Record<string, string> = { dice: 'dice', mini: 'minis', spell: 'spells', condition: 'conditions', turn: 'turns', fog: 'fog', door: 'doors', wall: 'doors', water: 'water' };
  for (const id of IDS) assert.equal(catalog[id]?.group, expected[id.split('.')[0]], id);
});

test('the sound files stay under 1.5 MB together', () => {
  const total = readdirSync(dir).filter((name) => name.endsWith('.mp3')).reduce((sum, name) => sum + statSync(`${dir}/${name}`).size, 0);
  assert.ok(total < 1_500_000, `total ${total}`);
});

test('every mp3 is listed in SOURCES.md with a licence', () => {
  const sources = readFileSync(`${dir}/SOURCES.md`, 'utf8').split('\n');
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.mp3'))) {
    const row = sources.find((line) => line.includes(name));
    assert.ok(row, `${name} not in SOURCES.md`);
    assert.match(row, /\b(CC0|own)\b/, `${name} has no licence`);
  }
});

test('loadSound hands out fresh copies of the file bytes', async () => {
  const first = await loadSound('dice.hit');
  const second = await loadSound('dice.hit');
  assert.equal(first.length, CATALOG['dice.hit'].files.length);
  assert.equal(first[0].byteLength, CATALOG['dice.hit'].files[0].length);
  assert.notEqual(first[0], second[0]);
  new Uint8Array(first[0])[0] ^= 0xff;
  assert.notEqual(new Uint8Array(first[0])[0], new Uint8Array(second[0])[0]);
});
