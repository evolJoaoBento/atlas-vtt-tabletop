// Copies Interactive Dice's kit/*.ts and its default texture pack into src/dice/kit/ and records
// where they came from. Tabletop never imports the other plugin at runtime.
// Usage: npm run sync:dice   (DICE_REPO overrides the default location of the Interactive Dice repo)
/* global process -- this script runs under Node */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(process.env.DICE_REPO ?? '../.obsidian/plugins/atlas-physical-dice');
const out = resolve('src/dice/kit');

const files = {};
const copyAll = (from, to, prefix, keep) => {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).filter(keep).sort()) {
    cpSync(`${from}/${name}`, `${to}/${name}`);
    files[prefix + name] = createHash('sha256').update(readFileSync(`${to}/${name}`)).digest('hex');
  }
};

rmSync(out, { recursive: true, force: true });
copyAll(`${repo}/kit`, out, '', (name) => name.endsWith('.ts'));
copyAll(`${repo}/dice/Texture-Pack-Default`, `${out}/default-pack`, 'default-pack/', () => true);

const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(`${out}/SOURCE.json`, `${JSON.stringify({ repo: 'atlas-physical-dice', commit, files }, null, 2)}\n`);
console.log(`Vendored ${Object.keys(files).length} files from ${repo} at ${commit}`);
