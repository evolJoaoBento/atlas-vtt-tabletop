import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BACKGROUND, type BackgroundSettings } from '../src/background/backgroundData';
import { BackgroundSettingsCache } from '../src/background/backgroundSettingsCache';

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
const named = (name: string): BackgroundSettings => ({ ...DEFAULT_BACKGROUND, name });

test('a settings read is asked once, answers null meanwhile and is kept when it lands', async () => {
  let asked = 0, filled = 0;
  const cache = new BackgroundSettingsCache(async () => { asked++; return named('A'); }, () => { filled++; });
  assert.equal(cache.get('f'), null);
  assert.equal(cache.get('f'), null);
  await settled();
  assert.equal(asked, 1);
  assert.equal(filled, 1);
  assert.equal(cache.get('f')?.name, 'A');
});

test('a read that started before the cache was cleared does not write back', async () => {
  const reads: ((value: BackgroundSettings | null) => void)[] = [];
  let filled = 0;
  const cache = new BackgroundSettingsCache(() => new Promise((resolve) => { reads.push(resolve); }), () => { filled++; });
  cache.get('f');
  cache.clear();
  reads[0]!(named('old'));
  await settled();
  assert.equal(filled, 0);
  assert.equal(cache.get('f'), null, 'asked again after the clear');
  assert.equal(reads.length, 2);
  reads[1]!(named('new'));
  await settled();
  assert.equal(cache.get('f')?.name, 'new');
});

test('a read that fails or finds nothing is dropped, so the next look tries again', async () => {
  const answers: (() => Promise<BackgroundSettings | null>)[] = [
    async () => { throw new Error('mid-save'); },
    async () => null,
    async () => named('ok'),
  ];
  let asked = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const cache = new BackgroundSettingsCache(() => answers[asked++]!(), () => {});
    for (let k = 0; k < 3; k++) { cache.get('f'); await settled(); }
    assert.equal(asked, 3);
    assert.equal(cache.get('f')?.name, 'ok');
  } finally { console.warn = warn; }
});
