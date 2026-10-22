// Copies Interactive Dice's kit/*.ts and its default texture pack into src/dice/kit/ and records
// where they came from. Tabletop never imports the other plugin at runtime.
// Text files are written with LF endings so the recorded hashes hold on any checkout.
// Usage: npm run sync:dice   (DICE_REPO overrides the default location of the Interactive Dice repo)
/* global process -- this script runs under Node */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(process.env.DICE_REPO ?? '../.obsidian/plugins/atlas-physical-dice');
const out = resolve('src/dice/kit');
const kitDir = `${repo}/kit`;
const packDir = `${repo}/dice/Texture-Pack-Default`;

for (const dir of [kitDir, packDir]) {
  if (!existsSync(dir)) {
    console.error(`Interactive Dice repo not found or incomplete: ${dir} is missing (set DICE_REPO).`);
    process.exit(1);
  }
}

const files = {};
const copyAll = (from, to, prefix, keep) => {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).filter(keep).sort()) {
    let bytes = readFileSync(`${from}/${name}`);
    if (/\.(ts|json)$/.test(name)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    writeFileSync(`${to}/${name}`, bytes);
    files[prefix + name] = createHash('sha256').update(bytes).digest('hex');
  }
};

rmSync(out, { recursive: true, force: true });
copyAll(kitDir, out, '', (name) => name.endsWith('.ts'));
copyAll(packDir, `${out}/default-pack`, 'default-pack/', () => true);

const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(`${out}/SOURCE.json`, `${JSON.stringify({ repo: 'atlas-physical-dice', commit, files }, null, 2)}\n`);
console.log(`Vendored ${Object.keys(files).length} files from ${repo} at ${commit}`);
