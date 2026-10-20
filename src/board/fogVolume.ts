/**
 * Atlas's fog of war standing on the 3D board: each area of fog (with the holes erased out of it) raised into a block
 * as tall as the GM set, in grid squares. The GM sees through it, as Atlas shows fog to the GM at half strength; a
 * faint outline marks its edges so its shape reads from any angle. The players' picture shows it solid and
 * unoutlined (`show('player')`, for that window's pass). Rebuilt only when the fog or its height changes.
 *
 * It moves like fog when the GM wants it to (`setMotion`), cheaply: its surfaces sample a small tiling noise twice,
 * drifting two ways, in their shader (no extra geometry); at "full", a sparse scatter of soft wisps drifts over its
 * top, one draw call whose drift the GPU works out. Both follow one clock (`tick`).
 */
import * as THREE from 'three';
import { fogAreas, type FogArea, type FogOperation } from './fog';
import { fogNoise, scatterWisps, type FogMotion } from './fogMotion';

/** Atlas shows the GM the fog at half strength. */
const GM_OPACITY = 0.5;
/** Just over the board, so its floor does not flicker with the map. */
const FLOOR = 0.5;
const NOISE_TEXELS = 128;
/** The noise repeats every this many grid squares. */
const NOISE_SQUARES = 4;
/** No more wisps than this, however much fog. */
const MAX_WISPS = 300;
/** The most pixels a wisp covers on screen: zoomed in, a few huge puffs would cost more than all the rest. */
const MAX_WISP_PX = 160;

export class FogVolume {
  readonly object3d = new THREE.Group();
  private key = '';
  private readonly sides = new THREE.MeshStandardMaterial({ color: 0x0b0b10, transparent: true, opacity: GM_OPACITY, depthWrite: false, roughness: 1, side: THREE.DoubleSide });
  private readonly caps = new THREE.MeshStandardMaterial({ color: 0x24242c, transparent: true, opacity: GM_OPACITY, depthWrite: false, roughness: 1, side: THREE.DoubleSide });
  private readonly edges = new THREE.LineBasicMaterial({ color: 0x9aa0b4, transparent: true, opacity: 0.35, depthWrite: false });
  /** Players cannot see through it: their own solid materials, swapped in for their pass. */
  private readonly playerSides = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 1, side: THREE.DoubleSide });
  private readonly playerCaps = new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 1, side: THREE.DoubleSide });
  private blocks: Array<{ mesh: THREE.Mesh; outline: THREE.LineSegments; extruded: boolean }> = [];
  /** The fog's areas, for what players cannot see under it. */
  areas: FogArea[] = [];

  private readonly noise: THREE.DataTexture;
  /** Shared by every fog material and the wisps: the clock, the noise and how strongly it shows. */
  private readonly uniforms = {
    uFogTime: { value: 0 },
    uFogNoise: { value: null as THREE.Texture | null },
    uFogScale: { value: 280 },
    uFogStrength: { value: 0 },
  };
  private motion: FogMotion = 'off';
  private wisps: THREE.Points | null = null;
  private readonly wispMaterial: THREE.PointsMaterial;
  private readonly puff: THREE.CanvasTexture | null;
  /** What the wisps were scattered for: the fog's top and its squares. */
  private top = FLOOR;
  private cellSize = 70;

  constructor() {
    this.object3d.name = 'fog';
    const values = fogNoise(NOISE_TEXELS, 11);
    const rgba = new Uint8Array(NOISE_TEXELS * NOISE_TEXELS * 4);
    values.forEach((value, i) => rgba.set([value, value, value, 255], i * 4));
    this.noise = new THREE.DataTexture(rgba, NOISE_TEXELS, NOISE_TEXELS);
    this.noise.wrapS = THREE.RepeatWrapping;
    this.noise.wrapT = THREE.RepeatWrapping;
    this.noise.magFilter = THREE.LinearFilter;
    this.noise.minFilter = THREE.LinearMipmapLinearFilter;
    this.noise.generateMipmaps = true;
    this.noise.needsUpdate = true;
    this.uniforms.uFogNoise.value = this.noise;
    // How much the noise lightens the fog: the see-through fog a little, the players' near-black fog a touch.
    this.drift(this.sides, 0.1);
    this.drift(this.caps, 0.16);
    this.drift(this.playerSides, 0.06);
    this.drift(this.playerCaps, 0.09);
    this.puff = puffTexture();
    this.wispMaterial = new THREE.PointsMaterial({ color: 0xb8bcc8, map: this.puff, size: 100, sizeAttenuation: true, transparent: true, opacity: 0.45, depthWrite: false });
    this.wispMaterial.onBeforeCompile = (shader): void => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uFogTime;\nattribute float aPhase;\nvarying float vWispFade;')
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          // Each wisp wanders slowly around where it was scattered, rising and sinking a little.
          'float drift = size * 0.4;',
          'transformed.x += sin(uFogTime * 0.3 + aPhase * 6.2832) * drift;',
          'transformed.z += cos(uFogTime * 0.24 + aPhase * 4.1) * drift;',
          'transformed.y += sin(uFogTime * 0.5 + aPhase * 9.0) * drift * 0.2;',
          'vWispFade = 0.5 + 0.5 * sin(uFogTime * 0.4 + aPhase * 12.0);',
        ].join('\n'))
        .replace('#include <clipping_planes_vertex>', `gl_PointSize = min(gl_PointSize, ${MAX_WISP_PX.toFixed(1)});\n#include <clipping_planes_vertex>`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWispFade;')
        .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vWispFade;\n#include <alphatest_fragment>');
    };
  }

  /** Makes a fog material sample the drifting noise: darker and lighter swirls, thinner and thicker where see-through. */
  private drift(material: THREE.MeshStandardMaterial, lift: number): void {
    material.onBeforeCompile = (shader): void => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;\nvarying float vFogUp;')
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          'vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          'vFogUp = abs(normalize(mat3(modelMatrix) * objectNormal).y);',
        ].join('\n'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFogTime;\nuniform sampler2D uFogNoise;\nuniform float uFogScale;\nuniform float uFogStrength;\nvarying vec3 vFogWorld;\nvarying float vFogUp;')
        .replace('#include <color_fragment>', [
          '#include <color_fragment>',
          // The top drifts across; the sides roll upward along the wall.
          'vec2 fogP = (vFogUp > 0.5 ? vFogWorld.xz : vec2(vFogWorld.x + vFogWorld.z, vFogWorld.y * 1.5)) / uFogScale;',
          'float fogN = texture2D(uFogNoise, fogP + uFogTime * vec2(0.045, 0.028)).r * 0.6',
          '  + texture2D(uFogNoise, fogP * 1.9 + uFogTime * vec2(-0.034, 0.04)).r * 0.4;',
          // Contrast around the middle: clear patches and thick billows, not an even grey.
          'fogN = smoothstep(0.2, 0.8, fogN);',
          'diffuseColor.rgb = diffuseColor.rgb * mix(1.0, 0.45 + fogN * 1.1, uFogStrength) + vec3(fogN * uFogStrength * ' + lift.toFixed(3) + ');',
          'diffuseColor.a *= mix(1.0, clamp(0.35 + fogN * 1.1, 0.0, 1.0), uFogStrength);',
        ].join('\n'));
    };
  }

  /** Shows the fog of `operations`, `height` grid squares of `cellSize` pixels tall (0 lays it flat on the map). */
  update(operations: readonly FogOperation[], height: number, cellSize: number): void {
    const key = JSON.stringify([operations, height, cellSize]);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const tall = Math.max(0, height) * cellSize;
    this.top = FLOOR + tall;
    this.cellSize = cellSize;
    this.uniforms.uFogScale.value = cellSize * NOISE_SQUARES;
    this.wispMaterial.size = cellSize * 2.2;
    this.areas = fogAreas(operations);
    for (const area of this.areas) {
      // Map y runs down the board (+z); a shape's y is flipped so laying it down puts it back.
      const shape = new THREE.Shape(area.outer.map((point) => new THREE.Vector2(point.x, -point.y)));
      shape.holes = area.holes.map((hole) => new THREE.Path(hole.map((point) => new THREE.Vector2(point.x, -point.y))));
      const geometry = tall > 0 ? new THREE.ExtrudeGeometry(shape, { depth: tall, bevelEnabled: false, curveSegments: 1 }) : new THREE.ShapeGeometry(shape, 1);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, FLOOR, 0);
      // An extrusion's first group is its caps (floor and top), its second its sides.
      const block = new THREE.Mesh(geometry, tall > 0 ? [this.caps, this.sides] : this.caps);
      block.renderOrder = 5;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), this.edges);
      outline.renderOrder = 6;
      this.object3d.add(block, outline);
      this.blocks.push({ mesh: block, outline, extruded: tall > 0 });
    }
    this.scatter();
  }

  /** How much the fog moves: off stands still, subtle rolls its surfaces, full adds wisps over it. */
  setMotion(motion: FogMotion): void {
    if (motion === this.motion) return;
    this.motion = motion;
    this.uniforms.uFogStrength.value = motion === 'off' ? 0 : 1;
    this.scatter();
  }

  /** Whether the fog moves on its own, so the board keeps drawing it. */
  get animated(): boolean {
    return this.motion !== 'off' && this.blocks.length > 0;
  }

  /** The fog's clock, in seconds. */
  tick(seconds: number): void {
    this.uniforms.uFogTime.value = seconds;
  }

  /** Scatters the wisps over the fog's top (at "full"), or takes them away. */
  private scatter(): void {
    if (this.wisps) {
      this.wisps.geometry.dispose();
      this.wisps.removeFromParent();
      this.wisps = null;
    }
    if (this.motion !== 'full' || this.areas.length === 0) return;
    const points = scatterWisps(this.areas, this.cellSize, 5, MAX_WISPS);
    if (points.length === 0) return;
    const positions = new Float32Array(points.length * 3);
    const phases = new Float32Array(points.length);
    points.forEach((point, i) => {
      positions.set([point.x, this.top + this.cellSize * 0.15, point.y], i * 3);
      phases[i] = (i * 0.618034) % 1;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.wisps = new THREE.Points(geometry, this.wispMaterial);
    this.wisps.renderOrder = 7;
    // Their drift moves them beyond their bounds: never culled for it.
    this.wisps.frustumCulled = false;
    this.object3d.add(this.wisps);
  }

  /** Dresses the fog for whose picture is drawn next: the GM's see-through, the players' solid. */
  show(viewer: 'gm' | 'player'): void {
    const gm = viewer === 'gm';
    for (const { mesh, outline, extruded } of this.blocks) {
      mesh.material = extruded ? (gm ? [this.caps, this.sides] : [this.playerCaps, this.playerSides]) : (gm ? this.caps : this.playerCaps);
      outline.visible = gm;
    }
  }

  /** Whether there is any fog on the map. */
  get empty(): boolean {
    return this.blocks.length === 0;
  }

  private clear(): void {
    this.blocks = [];
    this.areas = [];
    for (const child of [...this.object3d.children]) {
      (child as THREE.Mesh | THREE.LineSegments | THREE.Points).geometry.dispose();
      child.removeFromParent();
    }
    this.wisps = null;
  }

  dispose(): void {
    this.clear();
    for (const material of [this.sides, this.caps, this.edges, this.playerSides, this.playerCaps, this.wispMaterial]) material.dispose();
    this.noise.dispose();
    this.puff?.dispose();
    this.object3d.removeFromParent();
  }
}

/** A soft round puff: white, fading to nothing at its edge. */
function puffTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
