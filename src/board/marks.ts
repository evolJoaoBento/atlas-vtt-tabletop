/**
 * What people put on the board for a moment or for a while in a Connect session, drawn flat just over the map: lasting
 * templates (faintly filled and outlined in their owner's colour), the measure and the template being dragged, pings
 * (a ring that grows and fades) and lasers (a trail that fades behind its head). Used by a Connect player's board and
 * by the GM's board while hosting.
 */
import * as THREE from 'three';
import { conePoints, squareCorners, type MeasureShape, type TemplateMark, type TemplateShape } from './playerTools';
import { plateTexture } from './textures';

type Point = { x: number; y: number };

/** Over the map and the darkness, under the tokens' bases. */
const LIFT = 1.2;
const PING_SECONDS = 1.5;
const LASER_FADE_SECONDS = 1.2;
const MEASURE_COLOR = '#ffcc33';

interface Ping { group: THREE.Group; born: number }
interface Laser { line: THREE.Line; points: Array<Point & { at: number }>; lifted: boolean; color: string }

/** A flat outline of points on the map (x, y) laid on the board (x, z). */
function flat(points: readonly Point[], closed: boolean): THREE.BufferGeometry {
  const list = closed && points.length > 0 ? [...points, points[0]] : points;
  return new THREE.BufferGeometry().setFromPoints(list.map((point) => new THREE.Vector3(point.x, LIFT, point.y)));
}

function circlePoints(center: Point, radius: number, segments = 48): Point[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

/** A template's or measure's outline: closed for areas, open for a line. */
export function shapeOutline(shape: TemplateShape | MeasureShape, start: Point, end: Point, coneAngle: number): { points: Point[]; closed: boolean } {
  if (shape === 'circle') return { points: circlePoints(start, Math.hypot(end.x - start.x, end.y - start.y)), closed: true };
  if (shape === 'square') return { points: squareCorners(start, end), closed: true };
  if (shape === 'cone') return { points: conePoints(start, end, coneAngle), closed: true };
  return { points: [start, end], closed: false };
}

export class BoardMarks {
  readonly object3d = new THREE.Group();
  private readonly templates = new THREE.Group();
  private readonly overlay = new THREE.Group();
  private readonly pings: Ping[] = [];
  private readonly lasers = new Map<string, Laser>();
  private templateKey = '';

  constructor() {
    this.object3d.name = 'marks';
    this.object3d.add(this.templates, this.overlay);
  }

  /** The scene's lasting templates. */
  setTemplates(list: readonly TemplateMark[], coneAngle: number): void {
    const key = JSON.stringify([list, coneAngle]);
    if (key === this.templateKey) return;
    this.templateKey = key;
    clear(this.templates);
    for (const template of list) this.templates.add(this.shape(template.shape, template.start, template.end, template.color, coneAngle, 0.18));
  }

  /** The measure or template being dragged, with the measure's distance; nulls clear it. */
  setOverlay(measure: { shape: MeasureShape; start: Point; end: Point; label: string } | null, draft: { shape: TemplateShape; start: Point; end: Point; color: string } | null, coneAngle: number, pixel: number): void {
    clear(this.overlay);
    if (measure) {
      this.overlay.add(this.shape(measure.shape, measure.start, measure.end, MEASURE_COLOR, coneAngle, 0.12));
      const plate = plateTexture(measure.label, 24);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, transparent: true, depthTest: false }));
      // As the board's ruler labels: 22 screen pixels tall, whatever the distance.
      sprite.scale.set(pixel * 22 * (plate.width / plate.height), pixel * 22, 1);
      sprite.position.set(measure.end.x, LIFT, measure.end.y);
      sprite.renderOrder = 10;
      this.overlay.add(sprite);
    }
    if (draft) this.overlay.add(this.shape(draft.shape, draft.start, draft.end, draft.color, coneAngle, 0.18));
  }

  /** Someone's ping: a ring that grows and fades over a second and a half. */
  ping(x: number, y: number, color: string, now: number): void {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
    group.add(ring);
    group.position.set(x, LIFT, y);
    this.object3d.add(group);
    this.pings.push({ group, born: now });
  }

  /** New points of someone's laser (`from`); its trail fades behind. */
  laser(from: string, points: readonly Point[], lifted: boolean, color: string, now: number): void {
    let laser = this.lasers.get(from);
    if (!laser) {
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
      line.renderOrder = 11;
      this.object3d.add(line);
      laser = { line, points: [], lifted: false, color };
      this.lasers.set(from, laser);
    }
    (laser.line.material as THREE.LineBasicMaterial).color.set(color);
    for (const point of points) laser.points.push({ x: point.x, y: point.y, at: now });
    laser.lifted = lifted;
    this.drawLaser(laser);
  }

  get animating(): boolean {
    return this.pings.length > 0 || this.lasers.size > 0;
  }

  /** Ages the pings and lasers to `now` (seconds); returns whether any is still showing. */
  step(now: number, pixel: number): boolean {
    for (const ping of [...this.pings]) {
      const age = (now - ping.born) / PING_SECONDS;
      if (age >= 1) {
        this.object3d.remove(ping.group);
        disposeTree(ping.group);
        this.pings.splice(this.pings.indexOf(ping), 1);
        continue;
      }
      // A ring of about 40 screen pixels at its widest.
      ping.group.scale.setScalar(Math.max(1, 40 * pixel * (0.3 + 0.7 * age)));
      ((ping.group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - age;
    }
    for (const [from, laser] of [...this.lasers]) {
      laser.points = laser.points.filter((point) => now - point.at < LASER_FADE_SECONDS);
      if (laser.points.length === 0 && laser.lifted) {
        this.object3d.remove(laser.line);
        laser.line.geometry.dispose();
        (laser.line.material as THREE.Material).dispose();
        this.lasers.delete(from);
        continue;
      }
      this.drawLaser(laser);
    }
    return this.animating;
  }

  dispose(): void {
    disposeTree(this.object3d);
    this.pings.length = 0;
    this.lasers.clear();
  }

  private drawLaser(laser: Laser): void {
    laser.line.geometry.dispose();
    laser.line.geometry = flat(laser.points, false);
  }

  private shape(shape: TemplateShape | MeasureShape, start: Point, end: Point, color: string, coneAngle: number, fill: number): THREE.Group {
    const group = new THREE.Group();
    const { points, closed } = shapeOutline(shape, start, end, coneAngle);
    const line = closed ? new THREE.LineLoop(flat(points, false), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }))
      : new THREE.Line(flat(points, false), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }));
    line.renderOrder = 9;
    group.add(line);
    if (closed && points.length >= 3) {
      const area = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.y)));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(area).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fill, depthWrite: false, side: THREE.DoubleSide }));
      mesh.position.y = LIFT;
      mesh.renderOrder = 8;
      group.add(mesh);
    }
    return group;
  }
}

function clear(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeTree(child);
  }
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}
