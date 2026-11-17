// Bundles every tests/*.test.ts (with the source it imports) and runs, with node:test, the ones whose imports changed.
//
// Usage: node tests/run.mjs [--full] [name regex]
//   (no arguments)  the affected tests: new ones, ones that failed last time, and ones any of whose files (what
//                   esbuild bundled into them, from the import graph) changed since they last passed;
//   --full          every test;
//   <name regex>    the test files whose name matches, whatever changed.
// A test that reads files at run time (fs) depends on the whole repo, so it runs whenever anything changed.
// What passed is kept in .test-cache/unit.json (scripts/testCache.cjs).
/* global process -- this runner runs under Node */
import { build } from 'esbuild';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import cache from '../scripts/testCache.cjs';

const out = '.test-build';
const failedFile = `${out}/failed.json`;
const args = process.argv.slice(2);
const pattern = args.find((arg) => !arg.startsWith('--'));
const only = pattern ? new RegExp(pattern) : null;
const full = cache.full();

rmSync(out, { recursive: true, force: true });
const entries = readdirSync('tests').filter((name) => name.endsWith('.test.ts')).map((name) => `tests/${name}`);
const result = await build({ entryPoints: entries, bundle: true, platform: 'node', format: 'esm', outdir: out, outExtension: { '.js': '.mjs' }, alias: { obsidian: './tests/obsidian-stub.ts' }, logLevel: 'warning', jsx: 'automatic', loader: { '.png': 'binary', '.mp3': 'binary' }, metafile: true,
  // cannon-es's CommonJS build asks for perf_hooks at run time: an ES module has no `require` of its own.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });

const outputOf = (entry) => `${out}/${entry.slice('tests/'.length).replace(/\.ts$/, '.mjs')}`;
/** Each test's files from the import graph (no node_modules: the lock file stands for those). */
const graph = new Map();
for (const [output, meta] of Object.entries(result.metafile.outputs)) {
  if (!meta.entryPoint) continue;
  graph.set(meta.entryPoint.replace(/\\/g, '/'), Object.keys(meta.inputs).map((file) => file.replace(/\\/g, '/')).filter((file) => !file.startsWith('node_modules/')));
  void output;
}

// What every test depends on: this runner, the stubs and fixtures, the dependencies.
const globals = () => cache.hashFiles(['tests/run.mjs', 'scripts/testCache.cjs', 'package-lock.json', ...cache.repoFiles(['tests']).filter((file) => !file.endsWith('.test.ts'))]);
const tree = () => cache.hashFiles(cache.repoFiles(['src', 'packages', 'scripts', 'tests', 'harness', 'main.ts', 'styles.css', 'manifest.json', 'package.json', 'package-lock.json', 'esbuild.config.mjs', 'versions.json']));
const special = new Map();
const now = (key) => {
  if (!key.startsWith('@')) return cache.hashFile(key);
  if (!special.has(key)) special.set(key, key === '@globals' ? globals() : tree());
  return special.get(key);
};
const READS_FILES = /\b(readFileSync|readdirSync|readFile|readdir|statSync|existsSync|opendirSync)\b/;
const depsOf = (entry) => {
  const files = graph.get(entry) ?? [entry];
  const keys = ['@globals', ...files, ...(READS_FILES.test(readFileSync(entry, 'utf8')) ? ['@tree'] : [])];
  return Object.fromEntries(keys.map((key) => [key, now(key)]));
};

const kept = cache.load('unit');
const chosen = entries.filter((entry) => (only ? only.test(path.basename(entry)) : full || !cache.unchanged(kept[entry], now)));
const skipped = only ? 0 : entries.length - chosen.length;
if (!chosen.length) {
  console.log(`affected: 0 of ${entries.length} test files (all unchanged since they last passed; --full runs them all)`);
  process.exit(0);
}

const run = spawnSync(process.execPath, ['--test',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=./tests/fileReporter.mjs', `--test-reporter-destination=${failedFile}`,
  ...chosen.map(outputOf)], { stdio: 'inherit' });

// Remember what passed: a file is failed when any of its tests failed, or the run never reported it.
let failed = null;
try { failed = new Set(JSON.parse(readFileSync(failedFile, 'utf8')).map((file) => path.resolve(file))); } catch { failed = null; }
for (const entry of chosen) {
  const bad = failed === null || failed.has(path.resolve(outputOf(entry)));
  if (bad) delete kept[entry];
  else kept[entry] = depsOf(entry);
}
for (const entry of Object.keys(kept)) if (!entries.includes(entry)) delete kept[entry];
cache.save('unit', kept);
if (skipped) console.log(`affected: ran ${chosen.length} of ${entries.length} test files (${skipped} unchanged since they last passed; --full runs them all)`);
process.exit(run.status ?? 1);
