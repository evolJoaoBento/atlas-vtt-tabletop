import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MIN_ATLAS_VERSION } from '../packages/atlas-host/src/index';
import { FUSION_PROTOCOL } from '../src/connectWire';

// The tests run from the repository root (`npm test`).
const ROOT = process.cwd();
const check = (root?: string) => spawnSync(process.execPath, [join(ROOT, 'scripts/sync-connect.mjs'), '--check', ...(root ? ['--root', root] : [])], { encoding: 'utf8' });

/** A copy of what the check reads: the record, the packages and the generated wire file. */
function copyOfTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabletop-sync-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'packages'), join(dir, 'packages'), { recursive: true });
  cpSync(join(ROOT, 'connect-sync.json'), join(dir, 'connect-sync.json'));
  cpSync(join(ROOT, 'src/connectWire.ts'), join(dir, 'src/connectWire.ts'));
  return dir;
}

test("Tabletop's copies of Connect's packages and wire contract are as the sync left them", () => {
  const run = check();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /match Connect [0-9a-f]{7}/);
});

test('a hand edit of the generated wire contract, or of a copied package file, fails the check', () => {
  const wire = copyOfTree();
  writeFileSync(join(wire, 'src/connectWire.ts'), `${readFileSync(join(wire, 'src/connectWire.ts'), 'utf8')}\nexport const edited = 1;\n`);
  const first = check(wire);
  assert.equal(first.status, 1);
  assert.match(first.stderr, /changed: src\/connectWire\.ts/);

  const host = copyOfTree();
  writeFileSync(join(host, 'packages/atlas-host/src/pairing.ts'), '// edited\n');
  writeFileSync(join(host, 'packages/atlas-host/src/extra.ts'), 'export {};\n');
  const second = check(host);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /changed: packages\/atlas-host\/src\/pairing\.ts/);
  assert.match(second.stderr, /not from the sync: packages\/atlas-host\/src\/extra\.ts/);
});

test('the Atlas floor is no newer than the tag the shared Atlas files are copied from (0.16's reader reads 0.15's records), and the wire carries the fusion step', () => {
  const source = JSON.parse(readFileSync(join(ROOT, 'packages/atlas-shared/SOURCE.json'), 'utf8')) as { tag: string };
  assert.equal(MIN_ATLAS_VERSION, '0.15.0');
  const parts = (version: string): number[] => version.split('.').map(Number);
  const [floor, tag] = [parts(MIN_ATLAS_VERSION), parts(source.tag)];
  assert.ok((tag[0]! - floor[0]! || tag[1]! - floor[1]! || tag[2]! - floor[2]!) >= 0, source.tag);
  assert.equal(FUSION_PROTOCOL, 4);
});
