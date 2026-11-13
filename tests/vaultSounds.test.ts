import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import { CATALOG } from '../src/sound/catalog';
import { SoundEngine } from '../src/sound/soundEngine';
import { VaultSounds } from '../src/sound/vaultSounds';

const FOLDER = 'Tabletop sounds';

type Listener = (file: TFile | TFolder, oldPath?: string) => void;

/** A vault of named files that records what is done to it, just enough of Obsidian's for VaultSounds. */
function fakeApp(initial: Record<string, number> = {}) {
  const files = new Map<string, { file: TFile; data: ArrayBuffer }>();
  const folders = new Map<string, TFolder>();
  const log: string[] = [];
  const handlers = new Map<string, Listener[]>();
  const state = { failWrites: false };
  const add = (path: string, data: ArrayBuffer): TFile => {
    const file = new TFile(path);
    files.set(path, { file, data });
    return file;
  };
  for (const [path, size] of Object.entries(initial)) {
    add(path, new ArrayBuffer(size));
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.set(parts.slice(0, i).join('/'), new TFolder(parts.slice(0, i).join('/')));
  }
  const vault = {
    getFiles: () => [...files.values()].map((entry) => entry.file),
    getAbstractFileByPath: (path: string) => files.get(path)?.file ?? folders.get(path) ?? null,
    readBinary: async (file: TFile) => files.get(file.path)!.data,
    createFolder: async (path: string) => { log.push(`folder ${path}`); folders.set(path, new TFolder(path)); },
    createBinary: async (path: string, data: ArrayBuffer) => { if (state.failWrites) throw new Error('disk full'); log.push(`create ${path}`); add(path, data); },
    create: async (path: string, text: string) => { if (state.failWrites) throw new Error('disk full'); log.push(`create ${path}`); add(path, new TextEncoder().encode(text).buffer as ArrayBuffer); },
    modifyBinary: async (file: TFile, data: ArrayBuffer) => { if (state.failWrites) throw new Error('disk full'); log.push(`modify ${file.path}`); files.set(file.path, { file, data }); },
    modify: async (file: TFile, text: string) => { log.push(`modify ${file.path}`); files.set(file.path, { file, data: new TextEncoder().encode(text).buffer as ArrayBuffer }); },
    on: (name: string, listener: Listener) => { handlers.set(name, [...(handlers.get(name) ?? []), listener]); return { name, listener }; },
  };
  const fileManager = { trashFile: async (file: TFile) => { log.push(`trash ${file.path}`); files.delete(file.path); } };
  const app = { vault, fileManager } as unknown as App;
  const fire = (name: string, file: TFile | TFolder, oldPath?: string) => { for (const listener of handlers.get(name) ?? []) listener(file, oldPath); };
  return { app, files, folders, log, fire, state };
}

function setup(initial: Record<string, number> = {}, folderSetting: () => string | undefined = () => undefined) {
  const world = fakeApp(initial);
  const notices: string[] = [];
  const sounds = new VaultSounds(world.app, folderSetting, (message) => notices.push(message));
  return { ...world, sounds, notices };
}

/** A window whose audio is a recording stand-in: decoding tells the size of the file. */
function fakeWindow(started: unknown[]) {
  const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ gain: param(), pan: param(), connect() {}, disconnect() {} });
  const context = {
    state: 'running', currentTime: 1, destination: {}, async resume() {}, async close() {},
    createGain: node, createStereoPanner: node,
    createBufferSource: () => ({ buffer: null as unknown, loop: false, playbackRate: { value: 1 }, onended: null, connect() {}, disconnect() {}, stop() {}, start() { started.push(this.buffer); } }),
    decodeAudioData: async (data: ArrayBuffer) => ({ size: data.byteLength }),
  };
  return { AudioContext: function () { return context; }, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, setTimeout: () => 0 } as unknown as Window;
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('the custom files are the top-level sound files of the folder, never those in built-in/', () => {
  const { sounds } = setup({
    [`${FOLDER}/door.open.mp3`]: 3, [`${FOLDER}/dice.hit-1.ogg`]: 3, [`${FOLDER}/dice.hit-2.ogg`]: 3,
    [`${FOLDER}/built-in/door.shut-1.mp3`]: 3, [`${FOLDER}/README.md`]: 3, 'Elsewhere/door.shut.mp3': 3,
  });
  assert.deepEqual(sounds.custom.filesOf('door.open'), [`${FOLDER}/door.open.mp3`]);
  assert.deepEqual(sounds.custom.filesOf('dice.hit'), [`${FOLDER}/dice.hit-1.ogg`, `${FOLDER}/dice.hit-2.ogg`]);
  assert.equal(sounds.custom.isCustom('door.shut'), false);
});

test('replace writes the new file first and only then trashes the older custom files of the sound', async () => {
  const { sounds, log, files } = setup({ [`${FOLDER}/door.open.mp3`]: 3, [`${FOLDER}/door.open-1.wav`]: 3, [`${FOLDER}/door.shut.mp3`]: 3 });
  const done = await sounds.replace('door.open', { name: 'My Door.OGG', arrayBuffer: async () => new ArrayBuffer(8) });
  assert.equal(done, true);
  assert.equal(log[0], `create ${FOLDER}/door.open.ogg`);
  assert.deepEqual(log.slice(1).sort(), [`trash ${FOLDER}/door.open-1.wav`, `trash ${FOLDER}/door.open.mp3`]);
  assert.deepEqual([...files.keys()].sort(), [`${FOLDER}/door.open.ogg`, `${FOLDER}/door.shut.mp3`]);
});

test('a replace whose write fails keeps the sound the player had', async () => {
  const { sounds, log, files, state } = setup({ [`${FOLDER}/door.open.mp3`]: 3 });
  state.failWrites = true;
  await assert.rejects(sounds.replace('door.open', { name: 'new.ogg', arrayBuffer: async () => new ArrayBuffer(8) }), /disk full/);
  assert.deepEqual([...files.keys()], [`${FOLDER}/door.open.mp3`]);
  assert.equal(log.some((line) => line.startsWith('trash')), false);
});

test('replace with the same type rewrites the file in place; a file type that is not accepted is refused', async () => {
  const { sounds, log, files } = setup({ [`${FOLDER}/door.open.mp3`]: 3 });
  assert.equal(await sounds.replace('door.open', { name: 'x.mp3', arrayBuffer: async () => new ArrayBuffer(9) }), true);
  assert.deepEqual(log, [`modify ${FOLDER}/door.open.mp3`]);
  assert.equal(files.get(`${FOLDER}/door.open.mp3`)?.data.byteLength, 9);
  assert.equal(await sounds.replace('door.open', { name: 'x.txt', arrayBuffer: async () => new ArrayBuffer(9) }), false);
});

test('the folder is created on the first write, not before, and a nested folder in steps', async () => {
  const { sounds, folders, log } = setup({}, () => 'Audio/Table');
  assert.equal(folders.size, 0);
  sounds.custom.filesOf('door.open');
  assert.equal(folders.size, 0, 'looking at the folder creates nothing');
  await sounds.replace('door.open', { name: 'x.mp3', arrayBuffer: async () => new ArrayBuffer(2) });
  assert.deepEqual(log.slice(0, 3), ['folder Audio', 'folder Audio/Table', 'create Audio/Table/door.open.mp3']);
});

test('reset trashes the custom files of that sound and nothing else', async () => {
  const { sounds, files } = setup({
    [`${FOLDER}/dice.hit-1.mp3`]: 3, [`${FOLDER}/dice.hit-2.mp3`]: 3, [`${FOLDER}/door.open.mp3`]: 3, [`${FOLDER}/built-in/dice.hit-1.mp3`]: 3,
  });
  await sounds.reset('dice.hit');
  assert.deepEqual([...files.keys()].sort(), [`${FOLDER}/built-in/dice.hit-1.mp3`, `${FOLDER}/door.open.mp3`]);
});

test('a vault event for a custom file reaches the engines, and the next play uses the new file', async () => {
  const { sounds, files, fire } = setup({ [`${FOLDER}/door.open.mp3`]: 7 });
  sounds.events();
  const started: Array<{ size: number }> = [];
  const engine = SoundEngine.shared(fakeWindow(started), sounds.custom.load)!;
  try {
    engine.play('door.open');
    await settle();
    assert.equal(started.at(-1)?.size, 7);
    // The file is replaced by a bigger one: modify event.
    const file = files.get(`${FOLDER}/door.open.mp3`)!;
    files.set(file.file.path, { file: file.file, data: new ArrayBuffer(12) });
    fire('modify', file.file);
    await settle();
    engine.play('door.open');
    assert.equal(started.at(-1)?.size, 12);
    // The file is deleted: the built-in sound is back.
    files.delete(file.file.path);
    fire('delete', file.file);
    await settle();
    engine.play('door.open');
    assert.ok(CATALOG['door.open'].files.some((bytes) => bytes.length === started.at(-1)?.size), 'one of the built-in door.open files');
  } finally {
    engine.dispose();
  }
});

test('events for files that are no custom sounds load nothing', async () => {
  const { sounds, files, fire } = setup({ [`${FOLDER}/door.open.mp3`]: 7 });
  sounds.events();
  const loads: string[] = [];
  const started: unknown[] = [];
  const engine = SoundEngine.shared(fakeWindow(started), Object.assign(async (id: string, builtIn?: boolean) => { loads.push(id); return sounds.custom.load(id as 'door.open', builtIn); }, {}))!;
  try {
    engine.play('door.open');
    await settle();
    const before = loads.length;
    for (const path of [`${FOLDER}/built-in/door.open-1.mp3`, `${FOLDER}/README.md`, 'Elsewhere/door.open.mp3']) {
      const stray = new TFile(path);
      files.set(path, { file: stray, data: new ArrayBuffer(1) });
      fire('create', stray);
    }
    await settle();
    assert.equal(loads.length, before);
  } finally {
    engine.dispose();
  }
});

test('the creation or removal of the folder itself looks at every sound afresh', async () => {
  const { sounds, files, fire } = setup();
  sounds.events();
  const loads: string[] = [];
  const engine = SoundEngine.shared(fakeWindow([]), async (id) => { loads.push(id); return [new ArrayBuffer(2)]; })!;
  try {
    engine.play('door.open');
    engine.play('door.shut');
    await settle();
    loads.length = 0;
    // Files appeared with the folder (a sync): the folder's own create event drops everything.
    files.set(`${FOLDER}/door.open.mp3`, { file: new TFile(`${FOLDER}/door.open.mp3`), data: new ArrayBuffer(4) });
    fire('create', new TFolder(FOLDER));
    await settle();
    assert.deepEqual(loads.sort(), ['door.open', 'door.shut']);
    assert.equal(sounds.custom.isCustom('door.open'), true);
  } finally {
    engine.dispose();
  }
});

test('a rename of a sound file counts for the old name and the new one', () => {
  const { sounds, files, fire } = setup({ [`${FOLDER}/door.open.mp3`]: 3 });
  sounds.events();
  assert.equal(sounds.custom.isCustom('door.open'), true);
  const old = files.get(`${FOLDER}/door.open.mp3`)!;
  files.delete(old.file.path);
  const moved = new TFile(`${FOLDER}/door.shut.mp3`);
  files.set(moved.path, { file: moved, data: old.data });
  fire('rename', moved, `${FOLDER}/door.open.mp3`);
  assert.equal(sounds.custom.isCustom('door.open'), false);
  assert.equal(sounds.custom.isCustom('door.shut'), true);
});

test('a folder setting that leaves the vault falls back to the default with one Notice', () => {
  const { sounds, notices } = setup({ [`${FOLDER}/door.open.mp3`]: 3 }, () => '../outside');
  assert.equal(sounds.folder, FOLDER);
  assert.equal(sounds.folder, FOLDER);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /\.\./);
  assert.equal(sounds.custom.isCustom('door.open'), true, 'the default folder is the one read');
});

test('a change in the custom files tells the settings list', async () => {
  const { sounds, files, fire } = setup();
  sounds.events();
  let told = 0;
  const stop = sounds.onChange(() => told++);
  const file = new TFile(`${FOLDER}/dice.caught.mp3`);
  files.set(file.path, { file, data: new ArrayBuffer(2) });
  fire('create', file);
  assert.equal(told, 1);
  stop();
  fire('modify', file);
  assert.equal(told, 1);
});

test('export writes every bundled file under built-in/ and a README, and nothing outside the folder', async () => {
  const { sounds, files } = setup();
  const count = await sounds.exportBuiltIn();
  const expected = Object.values(CATALOG).reduce((sum, entry) => sum + entry.files.length, 0);
  assert.equal(count, expected);
  const paths = [...files.keys()];
  assert.equal(paths.length, expected + 1);
  assert.ok(paths.includes(`${FOLDER}/README.md`));
  assert.ok(paths.includes(`${FOLDER}/built-in/dice.hit-4.mp3`));
  assert.ok(!paths.some((path) => /dice\.roll|spell\.loop\.(bludgeoning|piercing|slashing)/.test(path)), 'no removed id is exported');
  assert.ok(paths.every((path) => path.startsWith(`${FOLDER}/`)));
  assert.equal(sounds.custom.isCustom('dice.hit'), false, 'the exported copies are not overrides');
});
