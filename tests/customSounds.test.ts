import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, type SoundId } from '../src/sound/catalog';
import { BUILT_IN_DIR, cleanFolder, CustomSounds, parseSoundFile, resolveOverrides, soundsReadme } from '../src/sound/customSounds';
import { isSoundId, SOUND_INFO } from '../src/sound/soundInfo';

const FOLDER = 'Tabletop sounds';

test('a file name is read as a sound id, with an optional variant number', () => {
  assert.deepEqual(parseSoundFile(FOLDER, `${FOLDER}/dice.hit.mp3`), { id: 'dice.hit', variant: 0, ext: 'mp3', path: `${FOLDER}/dice.hit.mp3` });
  assert.deepEqual(parseSoundFile(FOLDER, `${FOLDER}/dice.hit-3.ogg`), { id: 'dice.hit', variant: 3, ext: 'ogg', path: `${FOLDER}/dice.hit-3.ogg` });
  assert.equal(parseSoundFile(FOLDER, `${FOLDER}/condition.prone.OGG`)?.id, 'condition.prone');
  assert.equal(parseSoundFile(FOLDER, `${FOLDER}/spell.impact.fire-12.wav`)?.variant, 12);
});

test('files that are not custom sounds are ignored', () => {
  for (const path of [
    `${FOLDER}/${BUILT_IN_DIR}/dice.hit-1.mp3`,   // the exported copies are never overrides
    `${FOLDER}/sub/dice.hit.mp3`,
    `${FOLDER}/dice.hit.txt`,                      // not an accepted extension
    `${FOLDER}/README.md`,
    `${FOLDER}/not.a.sound.mp3`,                   // unknown id
    `${FOLDER}/dice.hit-x.mp3`,
    `${FOLDER}/dice.mp3`,
    `${FOLDER}/.mp3`,
    `Other/dice.hit.mp3`,                          // another folder
    `${FOLDER}dice.hit.mp3`,
  ]) assert.equal(parseSoundFile(FOLDER, path), null, path);
});

test('every accepted extension is read', () => {
  for (const ext of ['mp3', 'ogg', 'wav', 'm4a', 'webm', 'flac']) assert.ok(parseSoundFile(FOLDER, `${FOLDER}/door.open.${ext}`), ext);
});

test('the overrides of each sound come in play order, the plain file first and then the numbers', () => {
  const found = resolveOverrides(FOLDER, [
    `${FOLDER}/dice.hit-2.mp3`, `${FOLDER}/dice.hit-10.mp3`, `${FOLDER}/dice.hit-1.mp3`,
    `${FOLDER}/door.open.ogg`, `${FOLDER}/${BUILT_IN_DIR}/door.shut-1.mp3`, `${FOLDER}/nothing.mp3`,
  ]);
  assert.deepEqual([...found.keys()].sort(), ['dice.hit', 'door.open']);
  assert.deepEqual(found.get('dice.hit'), [`${FOLDER}/dice.hit-1.mp3`, `${FOLDER}/dice.hit-2.mp3`, `${FOLDER}/dice.hit-10.mp3`]);
  assert.deepEqual(found.get('door.open'), [`${FOLDER}/door.open.ogg`]);
});

test('the folder setting is cleaned into a vault path, and empty means the default', () => {
  assert.equal(cleanFolder(undefined), 'Tabletop sounds');
  assert.equal(cleanFolder('  '), 'Tabletop sounds');
  assert.equal(cleanFolder('/My\\Sounds/'), 'My/Sounds');
  assert.equal(parseSoundFile('/Mine/', 'Mine/door.open.mp3')?.id, 'door.open');
});

test('every sound has a name and an occasion, and nothing else does', () => {
  assert.deepEqual(Object.keys(SOUND_INFO).sort(), Object.keys(CATALOG).sort());
  for (const info of Object.values(SOUND_INFO)) assert.ok(info.name.length > 0 && info.when.length > 0);
  assert.equal(SOUND_INFO['condition.prone'].name, 'Prone (condition)');
  assert.equal(SOUND_INFO['spell.impact.fire'].name, 'Fire impact');
  assert.ok(isSoundId('dice.hit') && !isSoundId('toString') && !isSoundId('nope'));
});

/** A vault folder of named files, with the built-in sounds as a stand-in. */
function setup(initial: Record<string, number> = {}) {
  const vault = new Map<string, ArrayBuffer>(Object.entries(initial).map(([path, size]) => [path, new ArrayBuffer(size)]));
  const changes: Array<SoundId[] | 'all'> = [];
  const notices: string[] = [];
  const custom = new CustomSounds(
    { paths: () => [...vault.keys()], read: async (path) => { const data = vault.get(path); if (!data) throw new Error('gone'); return data; } },
    () => FOLDER,
    async () => [new ArrayBuffer(100)],
    (message) => notices.push(message),
    (ids) => changes.push(ids),
  );
  return { vault, custom, changes, notices };
}

test('the loader serves a custom file when there is one, and the built-in set when not', async () => {
  const { custom } = setup({ [`${FOLDER}/door.open.mp3`]: 5, [`${FOLDER}/dice.hit-1.mp3`]: 3, [`${FOLDER}/dice.hit-2.mp3`]: 4 });
  assert.deepEqual((await custom.load('door.open')).map((b) => b.byteLength), [5]);
  assert.deepEqual((await custom.load('dice.hit')).map((b) => b.byteLength), [3, 4]);
  assert.deepEqual((await custom.load('door.shut')).map((b) => b.byteLength), [100]);
  assert.deepEqual((await custom.load('door.open', true)).map((b) => b.byteLength), [100], 'the built-in set can be asked for by name');
  assert.ok(custom.isCustom('door.open') && !custom.isCustom('door.shut'));
});

test('a file added, changed, renamed or deleted is noticed, and names the sounds to drop', async () => {
  const { vault, custom, changes } = setup();
  assert.equal(custom.isCustom('door.open'), false);
  vault.set(`${FOLDER}/door.open.mp3`, new ArrayBuffer(5));
  custom.fileChanged(`${FOLDER}/door.open.mp3`);
  assert.deepEqual(changes, [['door.open']]);
  assert.equal(custom.isCustom('door.open'), true);
  vault.delete(`${FOLDER}/door.open.mp3`);
  vault.set(`${FOLDER}/door.shut.mp3`, new ArrayBuffer(5));
  custom.fileChanged(`${FOLDER}/door.shut.mp3`, `${FOLDER}/door.open.mp3`);
  assert.deepEqual(changes.at(-1)?.slice().sort(), ['door.open', 'door.shut']);
  assert.equal(custom.isCustom('door.open'), false);
  assert.equal(custom.isCustom('door.shut'), true);
  vault.delete(`${FOLDER}/door.shut.mp3`);
  custom.fileChanged(`${FOLDER}/door.shut.mp3`);
  assert.equal(custom.isCustom('door.shut'), false);
});

test('files that are no sounds change nothing', () => {
  const { custom, changes } = setup();
  custom.fileChanged(`${FOLDER}/${BUILT_IN_DIR}/door.open-1.mp3`);
  custom.fileChanged(`${FOLDER}/README.md`);
  custom.fileChanged('Notes/door.open.mp3');
  assert.deepEqual(changes, []);
});

test('a new folder setting looks at everything afresh', () => {
  const { custom, changes } = setup();
  custom.folderChanged();
  assert.deepEqual(changes, ['all']);
});

test('a file that cannot be read is named once and the built-in set plays', async () => {
  const { vault, custom, notices } = setup({ [`${FOLDER}/door.open.mp3`]: 5 });
  custom.isCustom('door.open');
  vault.delete(`${FOLDER}/door.open.mp3`);
  assert.deepEqual((await custom.load('door.open')).map((b) => b.byteLength), [100]);
  await custom.load('door.open');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /"door\.open\.mp3"/);
});

test('a custom file that fails to decode gives one Notice naming it, and not again until it changes', async () => {
  const { custom, notices } = setup({ [`${FOLDER}/door.open.mp3`]: 5, [`${FOLDER}/door.shut-1.mp3`]: 5, [`${FOLDER}/door.shut-2.mp3`]: 5 });
  await custom.load('door.open');
  custom.load.customFailed?.('door.open', [0], true);
  custom.load.customFailed?.('door.open', [0], true);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /"door\.open\.mp3"/);
  assert.match(notices[0], /built-in/);
  custom.fileChanged(`${FOLDER}/door.open.mp3`);
  await custom.load('door.open');
  custom.load.customFailed?.('door.open', [0], true);
  assert.equal(notices.length, 2);
  await custom.load('door.shut');
  custom.load.customFailed?.('door.shut', [1], false);
  assert.match(notices[2], /"door\.shut-2\.mp3"/);
});

test('the README names every sound and the naming rule', () => {
  const text = soundsReadme(FOLDER);
  for (const id of Object.keys(CATALOG)) assert.ok(text.includes(`\`${id}\``), id);
  assert.match(text, /<sound id>-1\.<ext>/);
  assert.match(text, /built-in/);
  assert.match(text, /remote players/i);
});
