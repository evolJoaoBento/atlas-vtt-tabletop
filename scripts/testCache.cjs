// What the affected-only test runs remember between runs (tests/run.mjs, harness/features-test.cjs): content hashes of
// the files a test depended on when it last passed, kept in .test-cache/ (git-ignored). A test runs again when any
// of them changed, when it is new, or when it failed last time.
/* global require, module, process -- Node */
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const DIR = '.test-cache';

const hashText = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16);

const fileHashes = new Map();
/** A file's content hash ('' for one that is gone), read once a run. */
function hashFile(file) {
  if (!fileHashes.has(file)) fileHashes.set(file, existsSync(file) ? hashText(readFileSync(file)) : '');
  return fileHashes.get(file);
}

/** The repo's files (tracked and new, not ignored) under the given top-level folders or root names. */
function repoFiles(tops) {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\n').filter((file) => file && tops.some((top) => file === top || file.startsWith(`${top}/`)) && existsSync(file)).sort();
}

/** One hash for a set of files: their paths and contents. */
function hashFiles(files) {
  return hashText(files.map((file) => `${file}\0${hashFile(file)}`).join('\n'));
}

function load(name) {
  const file = path.join(DIR, `${name}.json`);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

function save(name, data) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data));
}

/** Whether every hash a record kept still holds now. */
function unchanged(kept, now) {
  if (!kept) return false;
  for (const [key, value] of Object.entries(kept)) if (now(key) !== value) return false;
  return true;
}

const full = () => process.argv.includes('--full') || process.env.TEST_FULL === '1';

module.exports = { hashText, hashFile, hashFiles, repoFiles, load, save, unchanged, full };
