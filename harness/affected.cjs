// Which browser checks a change can touch (harness/features-test.cjs): each feature's page is run with V8's coverage
// on, and the functions it ran are kept by the hash of their text in the bundle; next time, a feature runs again only
// when one of those functions, or any file's top-level code (constants, tables, class fields: all of it runs at load
// and any of it may be read), is no longer the same.
//
// The bundle is esbuild's (harness/run-ui.mjs), whose `  // src/board/ground.ts` lines start each module: a
// function belongs to the file whose part of the bundle it lies in. node_modules is left out (the lock file stands
// for it). Pure Node: TypeScript parses the bundle.
/* global require, module */
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { hashText } = require('../scripts/testCache.cjs');

// Any module: code, JSON, and the binary files bundled in (sounds, pictures).
const MARKER = /^ {2}\/\/ ([A-Za-z0-9_@./-]+\.[A-Za-z0-9]+)$/gm;

/**
 * A bundle's inventory: every function of the repo's own files under a key (`file|hash of its text|n-th of that
 * text in the file`), the keys by where each function ends (how V8's coverage names a function), the file at
 * each place, and a hash per file of its code outside any function (its top level, class fields).
 */
function inventory(bundle) {
  const text = readFileSync(bundle, 'utf8');
  const starts = [], files = [];
  for (const match of text.matchAll(MARKER)) { starts.push(match.index); files.push(match[1]); }
  const fileAt = (offset) => {
    let low = 0, high = starts.length - 1, found = -1;
    while (low <= high) { const mid = (low + high) >> 1; if (starts[mid] <= offset) { found = mid; low = mid + 1; } else high = mid - 1; }
    const file = found < 0 ? null : files[found];
    return file && !file.startsWith('node_modules/') ? file : null;
  };
  const source = ts.createSourceFile('bundle.js', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const keys = new Set(), byEnd = new Map(), seen = new Map();
  /** Per file: the ranges of its outermost functions, cut out of its top-level text. */
  const outer = new Map();
  const isFunction = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isClassStaticBlockDeclaration(node);
  const visit = (node, inFunction) => {
    let inside = inFunction;
    if (isFunction(node)) {
      const start = node.getStart(source), end = node.end, file = fileAt(start);
      if (file) {
        const body = text.slice(start, end), base = `${file}|${hashText(body)}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = `${base}|${n}`;
        keys.add(key);
        if (!byEnd.has(end)) byEnd.set(end, []);
        byEnd.get(end).push(key);
        if (!inFunction) { if (!outer.has(file)) outer.set(file, []); outer.get(file).push([start, end]); }
      }
      inside = true;
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  const tops = new Map();
  for (let i = 0; i < starts.length; i++) {
    const file = files[i];
    if (file.startsWith('node_modules/')) continue;
    const from = starts[i], to = i + 1 < starts.length ? starts[i + 1] : text.length;
    let rest = '', at = from;
    for (const [start, end] of outer.get(file) ?? []) {
      if (start < from || end > to) continue;
      rest += text.slice(at, start);
      at = end;
    }
    rest += text.slice(at, to);
    tops.set(file, hashText(rest));
  }
  // All of the files' top level runs when the page loads, and any of it may be read by a function that ran elsewhere
  // (a constant, a table, a class's fields): one hash of it all, which every feature depends on.
  const top = hashText([...tops.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, hash]) => `${file}\0${hash}`).join('\n'));
  return { keys, byEnd, fileAt, tops, top, length: text.length };
}

/**
 * What a feature's page ran of a bundle, from `Profiler.takePreciseCoverage`'s entries for it (one each time the page
 * loaded it): the keys of the functions it ran, and the bundle's top-level hash (all of it ran).
 */
function ran(entries, inv) {
  const fns = new Set();
  for (const fn of entries.flatMap((entry) => entry.functions)) {
    const range = fn.ranges[0];
    if (!range || range.count === 0 || (range.startOffset === 0 && range.endOffset >= inv.length - 2)) continue;
    const found = inv.byEnd.get(range.endOffset);
    if (found) for (const key of found) fns.add(key);
  }
  return { fns: [...fns].sort(), top: inv.top };
}

/** Whether a kept record still holds against the bundle as it is now. */
function holds(record, inv) {
  if (!record || !inv) return false;
  if (!Array.isArray(record.fns) || record.top !== inv.top) return false;
  for (const key of record.fns) if (!inv.keys.has(key)) return false;
  return true;
}

/** A stylesheet's hash without its comments ('' for none there). */
function cssHash(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return ''; }
  return hashText(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' '));
}

module.exports = { inventory, ran, holds, cssHash };
