import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { simplifyModel, triangleCount } from '../src/simplify';

const dense = (segments: number): THREE.Mesh => new THREE.Mesh(new THREE.SphereGeometry(1, segments, segments), new THREE.MeshStandardMaterial());

test('a model over the budget is thinned to about the budget, its vertices kept', async () => {
  const root = new THREE.Group();
  const a = dense(220);
  const b = dense(120);
  root.add(a, b);
  const vertices = [a.geometry.attributes.position!.count, b.geometry.attributes.position!.count];
  const before = triangleCount(root);
  assert.ok(before > 100_000, String(before));
  const result = await simplifyModel(root, 20_000);
  assert.equal(result.before, before);
  assert.ok(result.after <= 22_000 && result.after >= 10_000, String(result.after));
  assert.equal(triangleCount(root), result.after);
  // Skinning, UVs and normals stay valid: only the triangle list changes.
  assert.deepEqual([a.geometry.attributes.position!.count, b.geometry.attributes.position!.count], vertices);
});

test('a model within the budget is left as it is', async () => {
  const root = new THREE.Group();
  const mesh = dense(20);
  root.add(mesh);
  const index = mesh.geometry.index!.array;
  const result = await simplifyModel(root, 20_000);
  assert.equal(result.after, result.before);
  assert.equal(mesh.geometry.index!.array, index);
});

test('a non-indexed mesh is simplified too', async () => {
  const root = new THREE.Group();
  const mesh = dense(200);
  mesh.geometry = mesh.geometry.toNonIndexed();
  root.add(mesh);
  const result = await simplifyModel(root, 10_000);
  assert.ok(result.after <= 11_000, String(result.after));
});
