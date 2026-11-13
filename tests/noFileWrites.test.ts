import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The tests run from the repository root (`npm test`).
const source = (path: string): string => readFileSync(path, 'utf8');
const WRITERS = ['src/board/tokenWriter.ts', 'src/board/initiative.ts', 'src/board/tokenEdits.ts', 'src/board/resources.ts', 'src/board/undoRecorders.ts'];

test("no map file is edited: Atlas's store is the only writer of Atlas's records", () => {
  for (const path of WRITERS) {
    const text = source(path);
    assert.doesNotMatch(text, /InText\(/, `${path} edits a map file's text`);
    assert.doesNotMatch(text, /JSON\.stringify\(file\)/, `${path} writes a map file`);
    assert.doesNotMatch(text, /export function (applyInitiative|fileCannotRun|tokenToFile|recordedProcess|addToInitiative|removeFromInitiative)\b/, `${path} keeps a file engine`);
  }
  const writer = source('src/board/tokenWriter.ts');
  const deps = /export interface TokenWriterDeps \{([\s\S]*?)\n\}/.exec(writer)?.[1] ?? '';
  assert.doesNotMatch(deps, /\bprocess\b/, 'the writer is handed no way to edit a file');
  assert.doesNotMatch(writer, /'file'/, "no write ends in the file");
});
