/**
 * Browser harness: a fake Atlas map view (2D canvas, store, viewport, token sprites) with Tabletop's overlay over it,
 * and a GLB made here with GLTFExporter, read back through Tabletop's own loader. Not shipped.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Assignments } from '../src/assignments';
import { parseMini, type LoadedMini, type MiniLibrary } from '../src/library';
import { MiniOverlay } from '../src/overlay';
import { makeRichGlb } from './richGlb';
import type { AtlasSceneState, AtlasView, SpriteLike } from '../src/atlas';

async function makeGlb(): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  root.name = 'Hero';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 24), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
  body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf1c27d }));
  head.position.y = 1.5;
  head.name = 'Head';
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x2e86de }));
  nose.position.set(0, 1.5, 0.35);
  const sword = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), new THREE.MeshStandardMaterial({ color: 0xbdc3c7, metalness: 0.8, roughness: 0.3 }));
  sword.position.set(0.5, 0.8, 0.3);
  root.add(body, head, nose, sword);
  const idle = new THREE.AnimationClip('Idle', 2, [new THREE.VectorKeyframeTrack('Head.position', [0, 1, 2], [0, 1.5, 0, 0, 1.6, 0, 0, 1.5, 0])]);
  const walk = new THREE.AnimationClip('Walk', 0.6, [new THREE.VectorKeyframeTrack('Head.position', [0, 0.3, 0.6], [0, 1.5, 0, 0, 1.75, 0, 0, 1.5, 0])]);
  return new Promise((resolve, reject) => new GLTFExporter().parse(root, (out) => resolve(out as ArrayBuffer), reject, { binary: true, animations: [idle, walk] }));
}

type Sprite = { x: number; y: number; visible: boolean; alpha: number };

async function main(): Promise<void> {
  const glb = new URLSearchParams(location.search).has('rich') ? await makeRichGlb() : await makeGlb();
  const mini: LoadedMini = await parseMini(glb.slice(0));
  const thumb = await (async () => { const lib = Object.create((await import('../src/library')).MiniLibrary.prototype); lib.thumbs = new Map(); lib.models = new Map([['x', Promise.resolve(mini)]]); lib.thumbQueue = Promise.resolve(); lib.thumbRenderer = null; return lib.thumbnail('x'); })();
  if (thumb) { const img = document.createElement('img'); img.src = thumb; img.id = 'thumb'; img.style.cssText = 'width:96px;height:96px;background:#333'; document.body.appendChild(img); }
  const container = document.getElementById('view')!;
  const map = document.createElement('canvas');
  map.className = 'map';
  container.appendChild(map);

  const tokens: Record<string, { id: string; x: number; y: number; size?: number; rotation?: number; isHidden?: boolean; kind: string }> = {
    t1: { id: 't1', x: 175, y: 175, kind: 'token' },
    t2: { id: 't2', x: 420, y: 315, size: 1.5, rotation: 90, kind: 'token' },
    t3: { id: 't3', x: 595, y: 175, isHidden: true, kind: 'token' },
  };
  const sprites: Record<string, Sprite> = Object.fromEntries(Object.values(tokens).map((t) => [t.id, { x: t.x, y: t.y, visible: true, alpha: t.isHidden ? 0.5 : 1 }]));
  const cam = { x: 0, y: 0, zoom: 1 };
  const listeners = new Set<() => void>();
  const state: AtlasSceneState = { mapPath: 'maps/test.md', mapLoaded: true, isMapLoading: false, grid: { size: 70 }, objects: { tokens } };
  const port = {
    get scale() { return { x: cam.zoom }; },
    toScreen: (x: number, y: number) => ({ x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom }),
    toWorld: (p: { x: number; y: number }) => ({ x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y }),
  };
  const view: AtlasView = {
    viewId: 'v1',
    containerEl: container,
    atlasStore: { getState: () => state, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } },
    renderer: {
      getAppInstance: () => pixi,
      getViewportInstance: () => port,
      getGridOptions: () => ({ size: 70 }),
      getTokenRenderer: () => ({
        getTokenSprites: () => sprites as Record<string, SpriteLike>,
        hitTestTokens: (x: number, y: number) => Object.values(tokens).find((t) => Math.hypot(t.x - x, t.y - y) < 33 * (2 * (t.size ?? 1) - 1))?.id ?? null,
      }),
    },
  };
  const assignments = new Assignments();
  const library = { load: async () => mini } as unknown as MiniLibrary;
  const overlay = new MiniOverlay(view, assignments, library, (m, e) => console.error('failed', m, e));
  for (const id of ['t1', 't2', 't3']) assignments.set('maps/test.md', id, { mini: 'minis/hero.glb', scale: 1, turn: 0 });

  // Like Atlas's PIXI: draws only when asked to, and keeps no picture (the table must copy it at once).
  let renders = 0;
  const paint = (): void => {
    renders++;
    const rect = container.getBoundingClientRect();
    if (map.width !== rect.width || map.height !== rect.height) { map.width = rect.width; map.height = rect.height; }
    const g = map.getContext('2d')!;
    g.fillStyle = '#2d3a2e'; g.fillRect(0, 0, map.width, map.height);
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    for (let x = 0; x < 2000; x += 70) { const s = port.toScreen(x, 0); g.beginPath(); g.moveTo(s.x, 0); g.lineTo(s.x, map.height); g.stroke(); }
    for (let y = 0; y < 2000; y += 70) { const s = port.toScreen(0, y); g.beginPath(); g.moveTo(0, s.y); g.lineTo(map.width, s.y); g.stroke(); }
    for (const t of Object.values(tokens)) {
      const s = port.toScreen(sprites[t.id]!.x, sprites[t.id]!.y);
      g.globalAlpha = sprites[t.id]!.alpha;
      g.fillStyle = '#ddd'; g.beginPath(); g.arc(s.x, s.y, 31 * (2 * (t.size ?? 1) - 1) * cam.zoom, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
  };
  const pixi = {
    renderer: { render: (_stage: unknown, _options?: unknown): void => paint(), events: { domElement: map, setTargetElement: (el: unknown) => { void el; listenLikePixi(); } } },
    render(): void { this.renderer.render({}); },
  };
  let dirty = true;
  const loop = (): void => { if (dirty) { dirty = false; pixi.render(); } requestAnimationFrame(loop); };
  const changed = (): void => { dirty = true; };

  // Like PIXI's event system: down on the canvas, moves on the whole document, up on the window; Atlas drags tokens.
  const heard: Array<{ type: string; trusted: boolean; x: number; y: number }> = [];
  let dragging: string | null = null;
  const worldAt = (e: PointerEvent): { x: number; y: number } => { const r = map.getBoundingClientRect(); return port.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top }); };
  const down = (e: PointerEvent): void => {
    heard.push({ type: e.type, trusted: e.isTrusted, x: e.clientX, y: e.clientY });
    const w = worldAt(e);
    dragging = Object.values(tokens).find((t) => Math.hypot(t.x - w.x, t.y - w.y) < 33 * (2 * (t.size ?? 1) - 1))?.id ?? null;
  };
  const move = (e: PointerEvent): void => {
    heard.push({ type: e.type, trusted: e.isTrusted, x: e.clientX, y: e.clientY });
    if (!dragging) return;
    const w = worldAt(e);
    sprites[dragging]!.x = w.x; sprites[dragging]!.y = w.y; changed();
  };
  const up = (e: PointerEvent): void => {
    heard.push({ type: e.type, trusted: e.isTrusted, x: e.clientX, y: e.clientY });
    if (!dragging) return;
    const w = worldAt(e);
    tokens[dragging]!.x = w.x; tokens[dragging]!.y = w.y; sprites[dragging]!.x = w.x; sprites[dragging]!.y = w.y;
    dragging = null; changed();
  };
  const listenLikePixi = (): void => {
    map.removeEventListener('pointerdown', down); document.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
    map.addEventListener('pointerdown', down); document.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
  };
  listenLikePixi();
  loop();

  // A drag of t1 along a path, as Atlas moves the sprite while dragging.
  const drag = (to: { x: number; y: number }, ms = 700): Promise<void> => new Promise((done) => {
    changed();
    const from = { ...sprites.t1! };
    const start = performance.now();
    const tick = (): void => {
      const k = Math.min(1, (performance.now() - start) / ms);
      sprites.t1!.x = from.x + (to.x - from.x) * k;
      sprites.t1!.y = from.y + (to.y - from.y) * k;
      changed();
      if (k < 1) requestAnimationFrame(tick);
      else { tokens.t1!.x = to.x; tokens.t1!.y = to.y; done(); }
    };
    tick();
  });
  /** Where a world point of the map shows in the window, on the table or flat. */
  const project = (x: number, y: number): { x: number; y: number } => {
    const s = port.toScreen(x, y);
    const r = map.getBoundingClientRect();
    const table = (overlay as unknown as { table: { active: boolean; camera: THREE.Camera } | null }).table;
    if (!table?.active) return { x: r.left + s.x, y: r.top + s.y };
    const p = new THREE.Vector3(s.x, 0, s.y).project(table.camera);
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  };
  Object.assign(window, { harness: { cam, sprites, tokens, assignments, overlay, drag, shake: (id: string) => overlay.shake(id), mini, project, heard, renders: () => renders, map } });
  document.getElementById('status')!.textContent = `ready: footprint ${mini.footprint.toFixed(2)}, height ${mini.height.toFixed(2)}, clips ${mini.animations.map((c) => c.name).join(',')}`;
}

main().catch((error) => { document.getElementById('status')!.textContent = `error: ${error}`; console.error(error); });
