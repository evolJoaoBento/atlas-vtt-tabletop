import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFogHeight } from '../src/board/toolbar';

test('a fog height is a number of squares from 0; a comma works as a decimal point', () => {
  assert.equal(readFogHeight('2'), 2);
  assert.equal(readFogHeight(' 1,5 '), 1.5);
  assert.equal(readFogHeight('0'), 0);
  assert.equal(readFogHeight(''), null);
  assert.equal(readFogHeight('-1'), null);
  assert.equal(readFogHeight('tall'), null);
  assert.equal(readFogHeight('1000'), null);
});
