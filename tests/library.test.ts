import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importNotice, MINIS, sameBytes, sameFileAmong } from '../src/library';

const buffer = (...values: number[]): ArrayBuffer => Uint8Array.from(values).buffer;

test('sameBytes compares the whole file', () => {
  assert.equal(sameBytes(buffer(1, 2, 3), buffer(1, 2, 3)), true);
  assert.equal(sameBytes(buffer(1, 2, 3), buffer(1, 2, 4)), false);
  assert.equal(sameBytes(buffer(1, 2), buffer(1, 2, 3)), false);
});

test('a re-import finds the file it made before, under its name or a numbered copy; the first gap ends the search', async () => {
  const vault = new Map<string, ArrayBuffer>([['m/Orc.glb', buffer(9)], ['m/Orc 2.glb', buffer(1, 2)], ['m/Orc 4.glb', buffer(7)]]);
  const read = async (path: string): Promise<ArrayBuffer | null> => vault.get(path) ?? null;
  const names = ['m/Orc.glb', 'm/Orc 2.glb', 'm/Orc 3.glb', 'm/Orc 4.glb'];
  assert.equal(await sameFileAmong(names, read, buffer(1, 2)), 'm/Orc 2.glb');
  assert.equal(await sameFileAmong(names, read, buffer(9)), 'm/Orc.glb');
  assert.equal(await sameFileAmong(names, read, buffer(7)), null);
  assert.equal(await sameFileAmong(names, read, buffer(5)), null);
});

test('an import says in one notice what it made and what was already there', () => {
  assert.equal(importNotice(MINIS, 'minis', ['minis/Orc.glb'], []), 'Tabletop: imported 1 mini into minis.');
  assert.equal(importNotice(MINIS, 'minis', [], ['minis/Hero_Forge_Explorer_Demo.glb']), 'Tabletop: Hero_Forge_Explorer_Demo was already there, so it is used as it is.');
  assert.equal(importNotice(MINIS, 'minis', ['minis/A.glb', 'minis/B.glb'], ['minis/C.glb', 'minis/D.glb']), 'Tabletop: imported 2 minis into minis; 2 minis were already there, so they are used as they are.');
  assert.equal(importNotice(MINIS, 'minis', [], []), null);
});
