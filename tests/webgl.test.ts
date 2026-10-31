import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webglAvailable } from '../src/webgl';

test('WebGL is available when a context can be made, and the probe context is given back', () => {
  let lost = 0;
  const gl = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => { lost++; } } : null) };
  assert.equal(webglAvailable(() => ({ getContext: (kind) => (kind === 'webgl2' ? gl : null) })), true);
  assert.equal(lost, 1);
});

test('WebGL 1 is enough where WebGL 2 is missing', () => {
  assert.equal(webglAvailable(() => ({ getContext: (kind) => (kind === 'webgl' ? {} : null) })), true);
});

test('no context, or a canvas that throws, means no WebGL', () => {
  assert.equal(webglAvailable(() => ({ getContext: () => null })), false);
  assert.equal(webglAvailable(() => ({ getContext: () => { throw new Error('blocked'); } })), false);
  assert.equal(webglAvailable(() => { throw new Error('no canvas'); }), false);
});
