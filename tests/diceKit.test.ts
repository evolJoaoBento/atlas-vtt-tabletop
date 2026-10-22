import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dieFaceNormals, dieGeometry } from '../src/dice/kit/dieShapes';

const kitDir = 'src/dice/kit';
const source = JSON.parse(readFileSync(`${kitDir}/SOURCE.json`, 'utf8')) as { repo: string; commit: string; files: Record<string, string> };

test('every vendored kit file matches the hash recorded in SOURCE.json', () => {
  const names = Object.keys(source.files);
  assert.ok(names.length > 0);
  for (const name of names) {
    const hash = createHash('sha256').update(readFileSync(`${kitDir}/${name}`)).digest('hex');
    assert.equal(hash, source.files[name], `${name} was edited; re-run npm run sync:dice instead`);
  }
});

test('the vendored kit lists the kit modules and the default pack files', () => {
  const names = Object.keys(source.files);
  for (const name of ['faces.ts', 'dieShapes.ts', 'caught.ts', 'packs.ts', 'default-pack/pack.json', 'default-pack/d20_Numbers.png']) assert.ok(names.includes(name), name);
});

test('the vendored dieShapes builds a d20 with twenty face normals', () => {
  assert.equal(dieFaceNormals('d20', dieGeometry('d20', 1, {})).normals.length, 20);
});
