/**
 * The handles of the kept measurements, drawn on the board (Atlas's `MeasureHandles`): a badge with the shape's glyph at each
 * measurement's origin (or on the rim of the token it lies on), and on an area a dot at its far end and one beside it that
 * only turns it. They keep their size on screen, lift a little under the pointer and more while dragged, and the badge of the
 * measurement whose popover is open wears a ring in the accent. Where they stand (`places`) is what a press is tested against.
 */
import * as THREE from 'three';
import { END_RADIUS, HANDLE_RADIUS, turnSpot, type Handle, type HandlePart, type HandleRef, type HandleSpot } from './measureEdit';
import { measureDotTexture, measureHandleTexture } from './textures';

type Place = { x: number; y: number };

/** Over the map and the measurements, under nothing the GM presses: above the templates and the label of a measurement. */
const LIFT = 1.4;
const HOVER_LIFT = 1.12;
const DRAG_LIFT = 1.2;

/** What a measurement shows of itself to its handles. */
export interface HandleItem {
  id: string;
  shape: string;
  /** The measurement's colour, the accent where it names none. */
  color: string;
  spot: HandleSpot;
  /** Its points where it lies now (an aura around its token, a drag's preview). */
  points: readonly Place[];
  /** Its shape and size take a turn handle. */
  turns: boolean;
}

interface Drawn {
  item: HandleItem;
  origin: THREE.Sprite;
  end: THREE.Sprite | null;
  turn: THREE.Sprite | null;
}

const sameRef = (a: HandleRef | null, b: HandleRef | null): boolean => a?.id === b?.id && a?.part === b?.part;

export class MeasureHandleMarks {
  readonly object3d = new THREE.Group();
  private drawn = new Map<string, Drawn>();
  private key = '';
  private selected: string | null = null;
  private hovered: HandleRef | null = null;
  private dragging: HandleRef | null = null;
  private pixel = 0.002;
  private readonly textures = new Map<string, THREE.CanvasTexture>();

  constructor(private readonly accent: () => string) {
    this.object3d.name = 'measure-handles';
    this.object3d.visible = false;
  }

  /** Shown on the GM's board where measurements are edited (`mayEditMeasures`), put away elsewhere. */
  setVisible(on: boolean): void {
    this.object3d.visible = on;
  }

  get visible(): boolean {
    return this.object3d.visible;
  }

  /** The measurements to give handles, in the order they were kept: a later one's lie over an earlier one's. */
  set(items: readonly HandleItem[], selected: string | null): void {
    const key = JSON.stringify([items, selected]);
    if (key === this.key) return;
    this.key = key;
    this.selected = selected;
    for (const { origin, end, turn } of this.drawn.values()) for (const sprite of [origin, end, turn]) if (sprite) { this.object3d.remove(sprite); sprite.material.dispose(); }
    this.drawn = new Map();
    for (const item of items) {
      const origin = this.sprite(item.id, 'origin', this.badge(item, item.id === selected), item.spot.origin, 13);
      const end = item.spot.end ? this.sprite(item.id, 'end', this.dot(item.color), item.spot.end, 12) : null;
      const turn = item.spot.end && item.turns ? this.sprite(item.id, 'turn', this.dot(item.color), item.spot.end, 11) : null;
      this.drawn.set(item.id, { item, origin, end, turn });
    }
    this.step(this.pixel);
  }

  setHovered(ref: HandleRef | null): void {
    if (sameRef(this.hovered, ref)) return;
    this.hovered = ref;
    this.step(this.pixel);
  }

  setDragging(ref: HandleRef | null): void {
    if (sameRef(this.dragging, ref)) return;
    this.dragging = ref;
    this.step(this.pixel);
  }

  /** Sizes the handles to the screen (`pixel`: map pixels to a screen pixel) and places the turn handles, which stand a screen distance from the far end. */
  step(pixel: number): void {
    this.pixel = pixel;
    for (const [id, { item, origin, end, turn }] of this.drawn) {
      const size = (part: HandlePart, radius: number): number => 2 * radius * pixel * (this.dragging?.id === id && this.dragging.part === part ? DRAG_LIFT : this.hovered?.id === id && this.hovered.part === part ? HOVER_LIFT : 1);
      origin.scale.setScalar(size('origin', HANDLE_RADIUS));
      end?.scale.setScalar(size('end', END_RADIUS));
      if (turn) {
        turn.scale.setScalar(size('turn', END_RADIUS));
        const at = turnSpot({ shape: item.shape as never, points: item.points as never }, pixel);
        if (at) turn.position.set(at.x, LIFT, at.y);
        turn.visible = at !== null;
      }
    }
  }

  /** Where the handles stand on the map now, in the order they are drawn (a later one lies on top). */
  places(): Handle[] {
    const places: Handle[] = [];
    for (const { item, end, turn } of this.drawn.values()) {
      places.push({ id: item.id, part: 'origin', x: item.spot.origin.x, y: item.spot.origin.y });
      if (end && item.spot.end) places.push({ id: item.id, part: 'end', x: item.spot.end.x, y: item.spot.end.y });
      if (turn?.visible) places.push({ id: item.id, part: 'turn', x: turn.position.x, y: turn.position.z });
    }
    return places;
  }

  /** The measurement a handle is drawn for. */
  itemOf(id: string): HandleItem | null {
    return this.drawn.get(id)?.item ?? null;
  }

  private texture(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
    let texture = this.textures.get(key);
    if (!texture) { texture = make(); this.textures.set(key, texture); }
    return texture;
  }

  private badge(item: HandleItem, open: boolean): THREE.CanvasTexture {
    const accent = open ? this.accent() : null;
    return this.texture(`badge ${item.shape} ${item.color} ${accent ?? ''}`, () => measureHandleTexture(item.shape, item.color, accent));
  }

  private dot(color: string): THREE.CanvasTexture {
    return this.texture(`dot ${color}`, () => measureDotTexture(color));
  }

  private sprite(id: string, part: HandlePart, map: THREE.CanvasTexture, at: Place, order: number): THREE.Sprite {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, sizeAttenuation: false, transparent: true, depthTest: false }));
    sprite.position.set(at.x, LIFT, at.y);
    sprite.renderOrder = order;
    sprite.userData = { id, part };
    this.object3d.add(sprite);
    return sprite;
  }

  dispose(): void {
    for (const { origin, end, turn } of this.drawn.values()) for (const sprite of [origin, end, turn]) sprite?.material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.drawn.clear();
    this.textures.clear();
  }
}
