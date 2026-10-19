// A GLB like a real mini: an embedded texture and a skinned mesh with an idle and a walk clip.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export async function makeRichGlb(): Promise<ArrayBuffer> {
  const paint = document.createElement('canvas');
  paint.width = paint.height = 64;
  const g = paint.getContext('2d')!;
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#8e44ad' : '#f1c40f'; g.fillRect(0, i * 8, 64, 8); }
  const texture = new THREE.CanvasTexture(paint);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.CylinderGeometry(0.3, 0.4, 1.6, 16, 8);
  geometry.translate(0, 0.8, 0);
  const position = geometry.attributes.position!;
  const indices: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const w = Math.min(1, Math.max(0, position.getY(i) / 1.6));
    indices.push(0, 1, 0, 0);
    weights.push(1 - w, w, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const root = new THREE.Bone(); root.name = 'Root';
  const top = new THREE.Bone(); top.name = 'Top'; top.position.y = 0.8;
  root.add(top);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ map: texture }));
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, top]));
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x2e86de }));
  nose.position.set(0, 1.4, 0.35);
  const figure = new THREE.Group();
  figure.add(mesh, nose);
  const q = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(deg)).toArray();
  const idle = new THREE.AnimationClip('Idle', 2, [new THREE.QuaternionKeyframeTrack('Top.quaternion', [0, 1, 2], [...q(-8), ...q(8), ...q(-8)])]);
  const walk = new THREE.AnimationClip('Walk', 0.6, [new THREE.QuaternionKeyframeTrack('Top.quaternion', [0, 0.3, 0.6], [...q(-20), ...q(20), ...q(-20)])]);
  return new Promise((resolve, reject) => new GLTFExporter().parse(figure, (out) => resolve(out as ArrayBuffer), reject, { binary: true, animations: [idle, walk] }));
}
