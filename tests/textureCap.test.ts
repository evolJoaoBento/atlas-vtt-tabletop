import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { capObjectTextures, capTexture } from '../src/board/textureCap';
import { leaner, QUALITY } from '../src/board/quality';

const canvases: Array<{ width: number; height: number; drawn: unknown }> = [];
const fakeCanvas = (width: number, height: number) => {
  const canvas = { width, height, drawn: null as unknown, getContext: () => ({ drawImage: (image: unknown) => { canvas.drawn = image; } }) };
  canvases.push(canvas);
  return canvas;
};

test('a picture larger than the cap is drawn smaller, its shape kept, and its bitmap let go', () => {
  let closed = false;
  const bitmap = { width: 4096, height: 2048, close: () => { closed = true; } };
  const texture = new THREE.Texture(bitmap as never);
  assert.equal(capTexture(texture, 1024, fakeCanvas), true);
  const image = texture.image as { width: number; height: number; drawn: unknown };
  assert.deepEqual([image.width, image.height], [1024, 512]);
  assert.equal(image.drawn, bitmap);
  assert.equal(closed, true);
  assert.deepEqual(texture.userData.sourceSize, { width: 4096, height: 2048 });
});

test('a picture within the cap, no cap, a video or a data texture is left alone', () => {
  const small = new THREE.Texture({ width: 512, height: 512 } as never);
  assert.equal(capTexture(small, 1024, fakeCanvas), false);
  assert.equal(capTexture(new THREE.Texture({ width: 4096, height: 4096 } as never), undefined, fakeCanvas), false);
  const data = new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2);
  assert.equal(capTexture(data, 1, fakeCanvas), false);
});

test("a model's textures are each shrunk once, however many materials share them", () => {
  const shared = new THREE.Texture({ width: 2048, height: 2048 } as never);
  const normal = new THREE.Texture({ width: 4096, height: 4096 } as never);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared, normalMap: normal })));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial({ map: shared })]));
  assert.equal(capObjectTextures(root, 512, fakeCanvas), 2);
  assert.equal((shared.image as { width: number }).width, 512);
  assert.equal((normal.image as { width: number }).width, 512);
});

test('a board drawn lean on memory caps pictures at 1024 and maps at 4096; leanest at 512 and 2048, without layers', () => {
  const lean = leaner(QUALITY.low, 'lean');
  assert.deepEqual([lean.textureSide, lean.imageSide, lean.noLayers ?? false, lean.maxPixelRatio <= 1], [4096, 1024, false, true]);
  const leanest = leaner(QUALITY.low, 'leanest');
  assert.deepEqual([leanest.textureSide, leanest.imageSide, leanest.noLayers], [2048, 512, true]);
  assert.equal(leaner(QUALITY.low, 'normal').imageSide, undefined);
});
