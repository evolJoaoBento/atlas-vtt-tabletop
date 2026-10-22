// Bundles every tests/*.test.ts (with the source it imports) and runs them with node:test.
/* global process -- this runner runs under Node */
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const out = '.test-build';
rmSync(out, { recursive: true, force: true });
const entries = readdirSync('tests').filter((name) => name.endsWith('.test.ts')).map((name) => `tests/${name}`);
await build({ entryPoints: entries, bundle: true, platform: 'node', format: 'esm', outdir: out, outExtension: { '.js': '.mjs' }, external: ['obsidian'], logLevel: 'warning', loader: { '.png': 'binary' },
  // cannon-es's CommonJS build asks for perf_hooks at run time: an ES module has no `require` of its own.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
const files = entries.map((entry) => `${out}/${entry.slice('tests/'.length).replace(/\.ts$/, '.mjs')}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
