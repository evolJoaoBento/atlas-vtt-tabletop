import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { averageColour, FLAT_FALLBACK, flatMaterialOf } from '../src/board/flatMaterial';

test('the average colour of a picture skips clear pixels', () => {
  assert.deepEqual(averageColour([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0]), [127.5, 0, 127.5]);
  assert.equal(averageColour([1, 2, 3, 0]), null);
  assert.equal(averageColour([]), null);
});

test('a bare material puts its colour on a wall and takes every texture off', () => {
  const wall = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture(), metalness: 1 });
  flatMaterialOf('', [128, 64, 32]).apply(wall);
  assert.equal(wall.map, null);
  assert.equal(wall.normalMap, null);
  assert.equal(wall.metalness, 0);
  assert.equal(wall.color.getHexString(THREE.SRGBColorSpace), '804020');
  const unread = new THREE.MeshStandardMaterial();
  flatMaterialOf('', null).apply(unread);
  assert.equal(unread.color.getHex(THREE.SRGBColorSpace), FLAT_FALLBACK);
});
