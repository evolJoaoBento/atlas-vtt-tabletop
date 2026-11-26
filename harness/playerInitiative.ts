/**
 * The player window's initiative list harness: Tabletop's `PlayerWindowInitiative` (Atlas 0.20's players' list, copied) in a
 * page standing for the local player window, over a fake Atlas (its settings, its map view's store), the way
 * `BoardView.syncPlayerWidgets` mounts it.
 */
import './dom-polyfill';
import { createStore } from 'zustand/vanilla';
import { PlayerWindowInitiative } from '../src/board/playerInitiative';

/** A token's portrait: a coloured square with its initial, as a data URL. */
function portrait(letter: string, colour: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = colour;
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = 'rgba(0,0,0,0.35)';
  context.beginPath();
  context.arc(64, 54, 30, 0, Math.PI * 2);
  context.fill();
  context.fillRect(30, 86, 68, 42);
  context.fillStyle = '#fff';
  context.font = 'bold 36px sans-serif';
  context.textAlign = 'center';
  context.fillText(letter, 64, 66);
  return canvas.toDataURL('image/png');
}

const images: Record<string, string> = {
  'hero.png': portrait('H', '#3b6fb6'), 'mira.png': portrait('M', '#3f9a5b'), 'gob.png': portrait('G', '#9a5b3f'), 'orc.png': portrait('O', '#7a3b3b'), 'bat.png': portrait('B', '#5b4a7a'),
};

const entry = (id: string, tokenId: string, name: string, initiative: number, order: number, imagePath: string, fields: Record<string, unknown> = {}) => ({
  id, tokenId, name, initiative, initiativeModifier: 0, imagePath, isActive: false, isNPC: true, order, ...fields,
});
const token = (id: string, name: string, side: string | null, hp: { current: number; max: number } | null, imagePath: string, fields: Record<string, unknown> = {}) => ({
  id, name, imagePath, x: 0, y: 0, size: 1, rotation: 0, kind: 'character', isHidden: false, showRing: true, ringColor: '#ffffff', side, showNameplate: true,
  conditions: [], conditionValues: {}, resources: hp ? { hp: { ...hp, overriddenMax: false } } : {}, ...fields,
});

const state = () => ({
  mapPath: 'maps/harness.atlasmap',
  initiativeTrackerOpen: true,
  tokenSettings: { showNameplates: true },
  conditionsShownEntry: null,
  initiative: {
    entries: [
      entry('e-hero', 'hero', 'Hero', 18, 0, 'hero.png', { isActive: true, isNPC: false }),
      entry('e-gob', 'gob', 'Goblin', 12, 1, 'gob.png'),
      entry('e-bat', 'bat', 'Bat', 11, 2, 'bat.png'),
      entry('e-orc', 'orc', 'Orc', 5, 3, 'orc.png', { hiddenFromPlayers: false }),
      entry('e-mira', 'mira', 'Mira', 4, 4, 'mira.png', { isNPC: false }),
    ],
    currentIndex: 0, round: 2, isActive: true, config: { autoSort: true },
  },
  objects: {
    tokens: {
      hero: token('hero', 'Hero', 'players', { current: 20, max: 27 }, 'hero.png'),
      gob: token('gob', 'Goblin', 'opponents', { current: 7, max: 7 }, 'gob.png', { ringColor: '#e0a030' }),
      bat: token('bat', 'Bat', 'opponents', null, 'bat.png'),
      // Hidden from players: the list leaves it out
      orc: token('orc', 'Orc', 'opponents', { current: 3, max: 30 }, 'orc.png', { isHidden: true }),
      mira: token('mira', 'Mira', 'players', { current: 5, max: 20 }, 'mira.png'),
    },
  },
});

/** Atlas's settings service as the list reads it: Atlas's own layout is a column at the right edge; the player window overrides it. */
const settings = {
  localPlayerView: { showInitiative: true, showTokenNameplates: true, initiativePulse: true, initiativeMaxCards: 0, initiativeScale: 1, showWidgets: true },
  getLocalPlayerViewSettings() { return this.localPlayerView; },
  onChange: () => () => undefined,
  initiativeLayout: () => ({ fromTurn: true, dock: 'right', edges: ['right'], facesPlayers: false }),
  initiativeTurnOptions: () => ({ banner: true, movesOnTurn: false }),
};

const app = {
  workspace: { on: () => ({}), offref: () => undefined, getLeavesOfType: () => [] },
  vault: { adapter: { getResourcePath: (path: string) => images[path] ?? path }, getAbstractFileByPath: () => null },
  plugins: { plugins: { 'atlas-vtt': { settingsService: settings } } },
};

const stage = document.getElementById('board') as HTMLElement;
stage.classList.add('atlas-tabletop-player-stage');
const store = createStore(state);
let tracker = true;
const list = new PlayerWindowInitiative(stage, app as never, () => tracker);
list.setView({ atlasStore: store } as never);

Object.assign(window, {
  listTest: {
    ready: true, store, list, stage, settings,
    reset: () => store.setState(state(), true),
    /** The Atlas tracker closed, the board's own open (or not): the list is drawn while either is open. */
    tracker: (open: boolean) => { tracker = open; list.trackerChanged(); },
  },
});
