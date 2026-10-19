import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGlb } from '../src/glbCheck';

/** A GLB holding only a JSON chunk with `json`. */
function glb(json) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new ArrayBuffer(20 + body.length);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, body.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20).set(body);
  return out;
}

test('accepts a self-contained GLB', () => {
  checkGlb(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], images: [{ bufferView: 0, mimeType: 'image/png' }, { uri: 'data:image/png;base64,AA==' }] }));
});
test('refuses a GLB that links to files outside itself', () => {
  assert.throws(() => checkGlb(glb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.com/skin.png' }] })), /outside itself/);
  assert.throws(() => checkGlb(glb({ asset: { version: '2.0' }, buffers: [{ uri: 'body.bin', byteLength: 4 }] })), /outside itself/);
});
test('refuses mesh compression and things that are not GLBs', () => {
  assert.throws(() => checkGlb(glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] })), /Draco or Meshopt/);
  assert.throws(() => checkGlb(glb({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'] })), /Draco or Meshopt/);
  assert.throws(() => checkGlb(new TextEncoder().encode('{"asset":{}} not a glb at all').buffer), /magic/);
});
