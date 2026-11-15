// Copies Atlas's own code and texts that the board's copies of Atlas's panels use, from an Atlas source checkout:
// - the files in scripts/atlasPortList.mjs (and every Atlas file they import, up to the boundaries) into src/atlasPort/app,
//   in Atlas's folder layout, each with a source header;
// - Atlas's texts those files and src/atlasPort/atlasTextKeys.ts use, in every language Atlas speaks, into
//   src/atlasPort/atlasTextData.ts.
// Usage: node scripts/sync-atlas-port.mjs [Atlas source checkout] [--dry]   (default: ../atlas-vtt-0.15-ref, the floor)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { ALLOWED_PACKAGES, BOUNDARIES, PATCHES, PORT_ENTRIES } from './atlasPortList.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? '../atlas-vtt-0.15-ref');
const app = join(root, 'src/app');
if (!existsSync(join(app, 'i18n/languages.ts'))) throw new Error(`No Atlas source at ${root}; pass an Atlas source checkout.`);
const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
const OUT = 'src/atlasPort/app';
const SHIMS = 'src/atlasPort/shims';

const toPosix = (path) => path.split('\\').join('/');
const IMPORT = /(^|\n)(\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"]*?\sfrom\s+)?)(['"])([^'"]+)\3/g;

/** An import inside Atlas's source: relative, or absolute from Atlas's root (`src/app/...`, `src/utils/cn`). */
const isLocal = (spec) => spec.startsWith('.') || spec.startsWith('src/');
/** A package's name (`@radix-ui/react-slot`, `zustand` for `zustand/vanilla`). */
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

function resolveAtlas(from, spec) {
  const base = spec.startsWith('src/') ? resolve(root, spec) : resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  throw new Error(`${relative(app, from)} imports ${spec}, which is not in Atlas's source`);
}

/** `import type { A }`, `export type { A }`, or `import { type A, type B }`: types only, nothing at run time. */
function isTypeOnly(head) {
  if (/^\s*(?:import|export)\s+type\s/.test(head)) return true;
  const names = /\{([^}]*)\}/.exec(head)?.[1];
  if (!names || /^\s*(?:import|export)\s+[\w$]+\s*,/.test(head)) return false;
  const parts = names.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part.startsWith('type '));
}
/** The names a type-only import brings in (`A`, and `B` of `B as C`). */
const typeNamesOf = (head) => (/\{([^}]*)\}/.exec(head)?.[1] ?? '').split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean);

// Walk the entries' value imports, copying everything that is not a boundary. A type-only import of a file left out
// points at the generated shims/atlasTypes.ts instead, where every such type is `any`.
const files = new Map();
const problems = [];
const packages = new Map();
const parents = new Map();
const queue = PORT_ENTRIES.map((entry) => join(app, entry));
while (queue.length > 0) {
  const file = queue.pop();
  const key = toPosix(relative(app, file));
  if (files.has(key)) continue;
  const source = readFileSync(file, 'utf8');
  files.set(key, source);
  for (const dynamic of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)) problems.push(`${key} imports ${dynamic[1]} on demand (make it an entry or a boundary)`);
  for (const match of source.matchAll(IMPORT)) {
    const spec = match[4];
    if (/\.s?css$/.test(spec)) continue; // Atlas's live styles.css holds every stylesheet already
    if (/\?(inline|worker|url|raw)/.test(spec)) { problems.push(`${key} imports ${spec} (Vite only: needs a boundary)`); continue; }
    if (!isLocal(spec)) {
      const name = packageOf(spec);
      packages.set(name, [...(packages.get(name) ?? []), key]);
      if (!ALLOWED_PACKAGES.includes(name)) problems.push(`${key} imports the package ${spec}`);
      continue;
    }
    if (/\.(webp|png|jpe?g|svg|glb|wasm|json)$/.test(spec)) { problems.push(`${key} imports the asset ${spec} (needs a boundary)`); continue; }
    if (isTypeOnly(match[2])) continue;
    const target = toPosix(relative(app, resolveAtlas(file, spec)));
    if (target in BOUNDARIES) continue;
    if (!parents.has(target)) parents.set(target, key);
    queue.push(join(app, target));
  }
}

const lines = [...files.values()].reduce((sum, source) => sum + source.split('\n').length, 0);
console.log(`Atlas ${version}: ${files.size} files, ${lines} lines; packages: ${[...packages.keys()].sort().join(', ') || 'none'}.`);
if (dry) {
  const byDir = new Map();
  for (const [key, source] of files) {
    const dir = key.split('/').slice(0, key.startsWith('react/') || key.startsWith('packages/') ? 3 : 1).join('/');
    const [count, total] = byDir.get(dir) ?? [0, 0];
    byDir.set(dir, [count + 1, total + source.split('\n').length]);
  }
  for (const [dir, [count, total]] of [...byDir].sort((a, b) => b[1][1] - a[1][1])) console.log(`  ${String(total).padStart(6)} lines ${String(count).padStart(4)} files  ${dir}`);
  const chain = (key) => { const path = [key]; while (parents.has(path[0]) && path.length < 12) path.unshift(parents.get(path[0])); return path.join(" > "); };
  for (const want of (process.env.WHY ?? "").split(",").filter(Boolean)) { const hit = [...files.keys()].find((key) => key.startsWith(want)); if (hit) console.log(`  why ${want}: ${chain(hit)}`); }
  for (const problem of [...new Set(problems)]) console.log(`  problem: ${problem}`);
  process.exit(0);
}
if (problems.length > 0) throw new Error(`The port reaches past what Tabletop can take:\n  ${[...new Set(problems)].join('\n  ')}`);

// Write the copies, boundary imports pointed at the stand-ins.
rmSync(OUT, { recursive: true, force: true });
rmSync('src/atlasPort/utils', { recursive: true, force: true }); // Atlas's src/utils (imports reaching above src/app)
const textKeys = new Set();
// Namespaces of keys the copies build at run time (t(`tables.unit.${unit}`)): every key of them is copied.
const textSpaces = new Set();
// Every dotted string a copy holds (`'am.spawned'` in a table or a ternary, handed to `t` later): those that are Atlas's
// keys are copied too.
const textLiterals = new Set();
const looseTypes = new Set();
for (const [key, source] of files) {
  const from = join(app, key);
  let rewritten = source.replace(IMPORT, (whole, lead, head, quote, spec) => {
    if (/\.s?css$/.test(spec)) return `${lead}// (stylesheet ${spec}: in Atlas's styles.css)`;
    if (!isLocal(spec)) return whole;
    const target = toPosix(relative(app, resolveAtlas(from, spec)));
    // Types from a file left out are `any` (shims/atlasTypes.ts).
    const loose = !(target in BOUNDARIES) && !files.has(target) && isTypeOnly(head);
    if (loose) for (const name of typeNamesOf(head)) looseTypes.add(name);
    // A boundary points at its stand-in; an absolute import becomes relative (Tabletop has no `src/` alias).
    const to = loose ? `${SHIMS}/atlasTypes.ts` : target in BOUNDARIES ? `${SHIMS}/${BOUNDARIES[target]}` : posix.join(OUT, target);
    if (!loose && !(target in BOUNDARIES) && !spec.startsWith('src/')) return whole;
    let path = posix.relative(posix.dirname(posix.join(OUT, key)), to).replace(/\.tsx?$/, '').replace(/\/index$/, '');
    if (!path.startsWith('.')) path = `./${path}`;
    return `${lead}${head}${quote}${path}${quote}`;
  });
  let patched = rewritten;
  for (const patch of PATCHES.filter((entry) => entry.file === key)) {
    if (!patched.includes(patch.find)) throw new Error(`Atlas ${version}: the text a Tabletop patch looks for is gone from ${key}:
  ${patch.find}`);
    const shims = posix.relative(posix.dirname(posix.join(OUT, key)), SHIMS);
    patched = patched.replace(patch.find, patch.replace.replaceAll('@shims/', `${shims}/`));
  }
  rewritten = patched;
  for (const match of rewritten.matchAll(/\bt\(\s*'([\w.-]+)'/g)) textKeys.add(match[1]);
  for (const match of rewritten.matchAll(/\bt\(\s*`([\w-]+)\./g)) textSpaces.add(match[1]);
  for (const match of rewritten.matchAll(/['"`]([a-zA-Z][\w-]*(?:\.[\w-]+)+)['"`]/g)) textLiterals.add(match[1]);
  const out = join(OUT, key);
  mkdirSync(dirname(out), { recursive: true });
  // Atlas type-checks its own code; the copies name some of its types loosely (shims/atlasTypes.ts), so they are not checked again.
  writeFileSync(out, `// Atlas source: src/app/${key} @ ${version} (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).\n// @ts-nocheck\n${rewritten}`);
}

writeFileSync(`${SHIMS}/atlasTypes.ts`, [
  '// Generated by scripts/sync-atlas-port.mjs: the Atlas types the copies name from files Tabletop does not copy. Each is',
  '// `any` (the copies were type-checked in Atlas). Do not edit; run npm run sync:atlas.',
  '/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */',
  ...[...looseTypes].sort().map((name) => `export type ${name}<_A = any, _B = any, _C = any> = any;`),
  '',
].join('\n'));

// Atlas's texts: the keys the copies use, and the ones the board's own markup asks for.
async function load(entry) {
  const bundled = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'error' });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}
const { TRANSLATIONS } = await load(join(app, 'i18n/languages.ts'));
const { ATLAS_TEXT_KEYS } = await load('src/atlasPort/atlasTextKeys.ts');
for (const key of ATLAS_TEXT_KEYS) textKeys.add(key);
for (const key of Object.keys(TRANSLATIONS.en)) if (textSpaces.has(key.split('.')[0]) || textLiterals.has(key)) textKeys.add(key);
const missing = [...textKeys].filter((key) => TRANSLATIONS.en[key] === undefined);
if (missing.length > 0) throw new Error(`Atlas ${version} has no English text for: ${missing.join(', ')}`);
const keys = [...textKeys].sort();
const tables = {};
for (const [code, table] of Object.entries(TRANSLATIONS)) {
  tables[code] = Object.fromEntries(keys.filter((key) => table[key] !== undefined).map((key) => [key, table[key]]));
}
writeFileSync('src/atlasPort/atlasTextData.ts', [
  `// Generated by scripts/sync-atlas-port.mjs from Atlas ${version}'s src/app/i18n/locales (AGPL-3.0). Do not edit; run npm run sync:atlas.`,
  "import type { AtlasMessage } from './atlasText';",
  '',
  `export const ATLAS_TEXT_VERSION = '${version}';`,
  '',
  `export const ATLAS_TEXT_DATA: Readonly<Record<string, Readonly<Record<string, AtlasMessage>>>> = ${JSON.stringify(tables, null, 2)};`,
  '',
].join('\n'));
console.log(`Copied ${files.size} files to ${OUT} and ${keys.length} texts in ${Object.keys(tables).join(', ')}.`);
