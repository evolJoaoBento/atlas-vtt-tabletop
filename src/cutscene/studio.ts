/**
 * Where the GM makes cutscenes: the gallery of the map's cutscenes, the editor (a free camera, a timeline along the
 * bottom, shots made by clicking it) and the preview (a cutscene played on the GM's board alone). It sits over a board
 * and asks its host for everything outside it: the saved cutscenes, the settings, the map being shown and switching it.
 * One studio lives as long as the board's tab; the board under it can be replaced (a scene switch), and `mapChanged`
 * gives the new one its driver back.
 */

import { setIcon } from 'obsidian';
import type { Board } from '../board/board';
import type { CameraKeep } from '../board/camera';
import type { BoardSession, GmCutscene } from '../connectContract';
import { CutsceneRun } from './cutsceneRun';
import { CINEMATIC_ASPECTS, MAX_FADE_MS, MIN_FADE_MS, type CinematicAspect, type CinematicSettings } from './cinematicSettings';
import { addShot, allowedTransitions, levelOfPlace, mapOfPlace, MAX_AT_MS, MAX_SHOTS, placed, placeOf, removeShot, retime, setKeyframe, setTransition, updateShot, type Cutscene, type Shot, type Transition } from './cutsceneData';
import type { CinematicDriver } from './drivenView';
import { FreeCamera } from './freeCamera';
import { CutscenePlayback } from './playback';
import { mapLabel, PopupMenu, TimelineView, type MenuItem } from './timelineView';

/** What the studio needs of the world around it. */
export interface StudioHost {
  readonly board: Board;
  /** The map the board shows now. */
  mapPath(): string | null;
  /** The cutscenes made in a map. */
  cutscenes(mapPath: string): readonly Cutscene[];
  /** Keeps a cutscene in a map (replacing the one with its id, else adding it). */
  save(mapPath: string, cutscene: Cutscene): void;
  remove(mapPath: string, id: string): void;
  /** The map paths of the GM's Atlas view tabs: the maps a shot can look at. */
  mapTabs(): string[];
  /** The place the board shows now (`cutsceneData.ts` `placeAt`): its map, and its level where the scene has levels. */
  place(): string | null;
  /** Whether the board shows `place`: its map and, of a scene with levels, the level it names (a map's own place is its first level). */
  at(place: string): boolean;
  /**
   * Shows a place on the board: another of those maps (false when it is not a tab; the board is replaced before this
   * resolves), and the level the place names where it is not the one shown.
   */
  showPlace(place: string): Promise<boolean>;
  settings(): CinematicSettings;
  setSettings(changes: Partial<CinematicSettings>): void;
  /** Asks for a name; null when the person gives none. */
  askName(initial: string): Promise<string | null>;
  notice(text: string): void;
  /** Keeps the players' window on its last picture (true) while the GM frames shots, or lets it draw again (false). */
  holdPlayers(hold: boolean): void;
  /** Connect's hosted session, while it hands one over. */
  session(): BoardSession | null;
  /** Lends the open players' window to a run (true): it follows the run's board across maps instead of waiting for its own map; false gives it back. */
  lendPlayers(lend: boolean): void;
  /** Hands the run for players to whoever tells Connect (null: it is over). */
  publishRun(run: GmCutscene | null): void;
}

export type StudioState = 'idle' | 'gallery' | 'editing' | 'previewing' | 'running';

/** A preview under way: the run, its clock (which stops while a map loads) and the map it came from. */
interface Preview {
  run: CutscenePlayback;
  driver: CinematicDriver;
  clock: number;
  lastNow: number | null;
  /** A map is being switched to: the clock waits and the picture stays black. */
  switching: boolean;
  /** Maps that could not be shown; the run goes on over the map at hand. */
  failed: Set<string>;
  /** The map the editor was on, to go back to. */
  editMap: string | null;
}

/** An editing session: the cutscene, the free camera and what to put back when it ends. */
interface Session {
  home: string;
  cutscene: Cutscene;
  keep: CameraKeep;
  driver: CinematicDriver;
  preview: Preview | null;
}

let counter = 0;
const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const NO_SHOTS = 'Add a shot first: edit the cutscene and click its timeline.';
const NO_SESSION = 'Start a session in Connect to play a cutscene for players.';
const OLD_CONNECT = 'This Connect cannot show cutscenes: update it.';
/** Put on the board's root while a cutscene is being made: the bars cover the toolbar, so it is hidden (styles.css). */
const AUTHORING = 'tabletop-authoring';
/** Put on the board's root while Cinematic mode (the gallery) is open: the toolbar stays above the bars (styles.css). */
const CINEMATIC_MODE = 'tabletop-cinematic-mode';

export class CutsceneStudio {
  private mode: 'idle' | 'gallery' = 'idle';
  private session: Session | null = null;
  /** The editor is being left: a map is switched back, and nothing else may start. */
  private leaving = false;
  private gallery: HTMLElement | null = null;
  private galleryOptions = false;
  private confirming: string | null = null;
  private readonly menu: PopupMenu;
  private readonly timeline: TimelineView;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly previewButton: HTMLButtonElement;
  private readonly preBar: HTMLElement;
  private readonly preLabel: HTMLElement;
  private readonly preBack: HTMLButtonElement;
  private readonly prePrevious: HTMLButtonElement;
  private readonly preNext: HTMLButtonElement;
  private readonly keys = (event: KeyboardEvent): void => this.onKey(event);
  /** A cutscene running for players, or the live follow. */
  private readonly run: CutsceneRun;
  private readonly runBar: HTMLElement;
  private readonly runLabel: HTMLElement;
  private readonly runPrevious: HTMLButtonElement;
  private readonly runNext: HTMLButtonElement;
  /** A run's shots for the GM: what each sees, and a click cuts to it. */
  private readonly runTimeline: TimelineView;
  /** The players follow the GM's camera because Cinematic mode is open (the gallery started the live follow). */
  private galleryLive = false;
  /** Shot thumbnails drawn so far, by what they were drawn from. */
  private readonly thumbs = new Map<string, string | null>();

  constructor(private readonly root: HTMLElement, private readonly host: StudioHost) {
    const doc = root.ownerDocument;
    this.run = new CutsceneRun(host, (told) => host.publishRun(told), () => this.showRun());
    this.menu = new PopupMenu(root);
    this.timeline = new TimelineView(root, {
      add: (at) => { if (!this.session?.preview) this.addAt(at); },
      retime: (id, at) => { if (!this.session?.preview) this.amend((c) => retime(c, id, at)); },
      // In a preview a click on a shot cuts the preview to it; in the editor it frames the shot.
      select: (id) => { if (this.session?.preview) this.previewTo(id); else void this.goTo(id); },
      shotMenu: (id, x, y) => { if (!this.session?.preview) this.shotMenu(id, x, y); },
      gapMenu: (id, x, y) => { if (!this.session?.preview) this.gapMenu(id, x, y); },
    });
    this.timeline.hidden = true;
    // The strip's heading: the cutscene, what to do, Preview and Done.
    this.title = this.span(this.timeline.head, 'tabletop-timeline__title');
    this.hint = this.span(this.timeline.head, 'tabletop-timeline__hint');
    this.previewButton = this.button(this.timeline.head, 'Preview', () => this.preview(0), 'tabletop-timeline__preview');
    this.button(this.timeline.head, 'Done', () => this.stopEditing(), 'tabletop-timeline__done mod-cta');
    // The preview's controls take the strip's place.
    this.preBar = doc.createElement('div');
    this.preBar.className = 'tabletop-preview';
    this.preBar.hidden = true;
    this.prePrevious = this.button(this.preBar, 'Previous', () => this.previewStep(false), 'tabletop-preview__previous');
    this.preLabel = this.span(this.preBar, 'tabletop-preview__label');
    this.preNext = this.button(this.preBar, 'Next', () => this.previewStep(true), 'tabletop-preview__next');
    this.preBack = this.button(this.preBar, 'Back to editing', () => this.backToEditing(), 'tabletop-preview__back');
    this.preBar.addEventListener('pointerdown', (event) => event.stopPropagation());
    root.appendChild(this.preBar);
    // A run for players: the same strip, with End in place of Back to editing.
    this.runBar = doc.createElement('div');
    this.runBar.className = 'tabletop-run';
    this.runBar.hidden = true;
    this.runPrevious = this.button(this.runBar, 'Previous', () => this.run.previous(), 'tabletop-run__previous');
    this.runLabel = this.span(this.runBar, 'tabletop-run__label');
    this.runNext = this.button(this.runBar, 'Next', () => this.run.next(), 'tabletop-run__next');
    this.button(this.runBar, 'End', () => this.run.end(), 'mod-warning tabletop-run__end');
    this.runBar.addEventListener('pointerdown', (event) => event.stopPropagation());
    root.appendChild(this.runBar);
    this.runTimeline = new TimelineView(root, {
      add: () => undefined,
      retime: () => undefined,
      select: (id) => { const index = this.run.playing?.cutscene.shots.findIndex((shot) => shot.id === id) ?? -1; if (index >= 0) this.run.goTo(index); },
      shotMenu: () => undefined,
      gapMenu: () => undefined,
    }, true);
    this.runTimeline.hidden = true;
    this.span(this.runTimeline.head, 'tabletop-timeline__title', 'Click a shot to cut to it');
    doc.defaultView?.addEventListener('keydown', this.keys);
  }

  // ── A run for players ────────────────────────────────────────────────────

  /** Plays a cutscene of this map for players (Play for players); false, with a notice, when it cannot. */
  async play(id: string): Promise<boolean> {
    const home = this.host.mapPath();
    const found = home ? this.host.cutscenes(home).find((c) => c.id === id) : undefined;
    if (!home || !found || (this.state !== 'idle' && this.state !== 'gallery')) return false;
    // The players followed the GM's camera in Cinematic mode: the cutscene takes over from there.
    if (this.galleryLive && this.run.live) this.run.handOver();
    this.galleryLive = false;
    const started = await this.run.startPrepared(found, home);
    if (started) this.closeGallery(true);
    else if (this.mode === 'gallery') this.enterCinema();
    return started;
  }

  /** The toolbar's "Players follow my camera": starts the live follow, or ends it; a prepared cutscene playing is not its to end. */
  toggleLive(): void {
    if (this.run.running && this.run.mode === 'prepared') {
      this.host.notice('Tabletop: end the cutscene first.');
      return;
    }
    if (this.run.running) {
      this.run.end();
      return;
    }
    if (this.state !== 'idle' && this.state !== 'gallery') {
      this.host.notice('Tabletop: finish the cutscene you are making first.');
      return;
    }
    this.run.startLive();
    if (this.run.running) this.closeGallery(true);
  }

  /** Whether the players follow the GM's camera now. */
  get live(): boolean {
    return this.run.live;
  }

  /** Connect's session started or stopped: the gallery's Play buttons follow. */
  sessionChanged(): void {
    if (this.mode === 'gallery') this.renderGallery();
  }

  /** Ends the run for players (the session went); no-op without one. */
  endRun(): void {
    this.run.end();
  }

  /** Ends the run with no fade (Tabletop is unloading). */
  endRunNow(): void {
    this.run.dispose();
  }

  /** The GM board's camera while the players follow it; null otherwise. */
  liveCamera(): ReturnType<CutsceneRun['liveCamera']> {
    return this.run.liveCamera();
  }

  /** What the run shows the GM: Previous, Next and End with the shot, or End alone while live. */
  private showRun(): void {
    const position = this.run.position;
    if (!this.run.running) this.galleryLive = false;
    // In Cinematic mode the follow is the mode's own: leaving the mode ends it, so its bar is not shown.
    this.runBar.hidden = !this.run.running || (this.galleryLive && this.mode === 'gallery');
    const playing = this.run.playing;
    this.runTimeline.hidden = playing === null;
    this.runBar.classList.toggle('tabletop-run--with-timeline', playing !== null);
    if (playing) this.runTimeline.render(playing.cutscene, { home: this.host.mapPath() ?? '', mapName: mapLabel, thumbnail: (shot) => this.thumbnail(shot), current: playing.shot });
    if (position) {
      const live = this.run.mode === 'live';
      this.runLabel.textContent = live ? 'Players follow your camera' : `Shot ${position.shot + 1} of ${position.total}`;
      this.runPrevious.hidden = live;
      this.runNext.hidden = live;
      this.runPrevious.disabled = position.shot === 0 || this.run.ending;
      this.runNext.disabled = this.run.ending;
    }
    this.board?.refreshToolbar();
  }

  // ── State ────────────────────────────────────────────────────────────────

  get state(): StudioState {
    if (this.session) return this.session.preview ? 'previewing' : 'editing';
    if (this.run.running && !(this.mode === 'gallery' && this.galleryLive && this.run.live)) return 'running';
    return this.mode;
  }

  /** The cutscene being edited and the map whose gallery holds it. */
  get editing(): { home: string; cutscene: Cutscene } | null {
    return this.session ? { home: this.session.home, cutscene: this.session.cutscene } : null;
  }

  /** The shot a preview rests on (or heads to), and whether it rests. */
  get previewState(): { shot: number; resting: boolean } | null {
    const run = this.session?.preview?.run;
    return run ? { shot: run.shot, resting: !run.playing } : null;
  }

  private get board(): Board | null {
    return (this.host.board as Board | null) ?? null;
  }

  // ── Small DOM helpers ────────────────────────────────────────────────────

  private span(into: HTMLElement, className: string, text?: string): HTMLElement {
    const element = this.root.ownerDocument.createElement('span');
    element.className = className;
    if (text !== undefined) element.textContent = text;
    into.appendChild(element);
    return element;
  }

  private button(into: HTMLElement, label: string, run: () => void, className = '', title?: string): HTMLButtonElement {
    const made = this.root.ownerDocument.createElement('button');
    made.type = 'button';
    made.textContent = label;
    if (className) made.className = className;
    if (title) made.title = title;
    made.addEventListener('click', run);
    into.appendChild(made);
    return made;
  }

  /** A button showing one of Obsidian's icons (the ones Atlas uses), named for screen readers and its tooltip. */
  private iconButton(into: HTMLElement, icon: string, label: string, run: () => void, className = ''): HTMLButtonElement {
    const made = this.button(into, '', run, `clickable-icon tabletop-icon-button ${className}`.trim());
    setIcon(made, icon);
    made.setAttribute('aria-label', label);
    made.dataset.icon = icon;
    return made;
  }

  private focusBoard(): void {
    this.board?.canvas.focus();
  }

  // ── The gallery ──────────────────────────────────────────────────────────

  openGallery(): void {
    if (this.state !== 'idle' || !this.host.mapPath()) return;
    this.mode = 'gallery';
    this.renderGallery();
    this.enterCinema();
    this.board?.refreshToolbar();
  }

  /**
   * Cinematic mode at once: the board fades to black and comes back in the cinematic settings' bars, as a run starts
   * for players; with a Connect session hosted, the players follow the GM's camera from that black.
   */
  private enterCinema(): void {
    const board = this.board;
    if (!board) return;
    this.root.classList.add(CINEMATIC_MODE);
    // The GM frames freely: no angle or distance limits on the camera while Cinematic mode is open.
    board.setCameraUnbound(true);
    const session = this.host.session();
    const live = session?.hosting() === true && session.cutscenes === true;
    board.cinema.fadeThrough(this.host.settings().fadeMs, () => {
      if (this.mode !== 'gallery' || this.session) return;
      if (live && !this.run.running) {
        this.run.startLive();
        this.galleryLive = this.run.live;
        this.showRun();
      }
      if (!this.galleryLive) this.applyBars();
      this.board?.refreshToolbar();
    });
  }

  /** Leaves Cinematic mode's look: the board fades to black, the bars (and the players' follow) go there, and it fades back. */
  private leaveCinema(): void {
    const board = this.board;
    if (!board) return;
    this.root.classList.remove(CINEMATIC_MODE);
    board.setCameraUnbound(false);
    const live = this.galleryLive;
    this.galleryLive = false;
    board.cinema.fadeThrough(this.host.settings().fadeMs, () => {
      if (live && this.run.live) this.run.end();
      if (this.mode !== 'gallery' && !this.session && !this.run.running) this.board?.cinema.setBars(null);
      this.board?.refreshToolbar();
    });
  }

  /** `handOver`: a run or the editor takes the board's look on (no fade, no bars taken away). */
  closeGallery(handOver = false): void {
    if (this.mode !== 'gallery') return;
    if (handOver) {
      this.root.classList.remove(CINEMATIC_MODE);
      this.board?.setCameraUnbound(false);
      if (this.galleryLive && this.run.live) this.run.end();
      this.galleryLive = false;
    } else this.leaveCinema();
    this.mode = 'idle';
    this.galleryOptions = false;
    this.confirming = null;
    this.gallery?.remove();
    this.gallery = null;
    this.board?.refreshToolbar();
  }

  /** Whether the gallery or the editor (and its preview) is open: the board's Cinematic mode. A run for players is not. */
  get cinematic(): boolean {
    const state = this.state;
    return state === 'gallery' || state === 'editing' || state === 'previewing';
  }

  /** The GM picked Play or Edit: the gallery or the editor closes (the cutscene is saved as it is edited). A run goes on. */
  leaveCinematic(): void {
    if (this.session) {
      if (this.session.preview) this.backToEditing();
      this.stopEditing();
    } else this.closeGallery();
  }

  private renderGallery(): void {
    const home = this.host.mapPath();
    if (this.mode !== 'gallery' || !home) return;
    const doc = this.root.ownerDocument;
    if (!this.gallery) {
      this.gallery = doc.createElement('div');
      this.gallery.className = 'tabletop-gallery';
      this.gallery.addEventListener('pointerdown', (event) => event.stopPropagation());
      this.gallery.addEventListener('wheel', (event) => event.stopPropagation());
      this.root.appendChild(this.gallery);
    }
    const panel = this.gallery;
    panel.replaceChildren();
    const head = doc.createElement('div');
    head.className = 'tabletop-gallery__head';
    panel.appendChild(head);
    this.span(head, 'tabletop-gallery__title', 'Cutscenes');
    this.iconButton(head, 'plus', 'New cutscene', () => { void this.create(); }, 'tabletop-gallery__add');
    const options = this.iconButton(head, 'settings', 'Cinematic settings', () => { this.galleryOptions = !this.galleryOptions; this.renderGallery(); }, 'tabletop-gallery__options');
    options.setAttribute('aria-expanded', String(this.galleryOptions));
    options.classList.toggle('is-active', this.galleryOptions);
    if (this.galleryOptions) panel.appendChild(this.settingsForm());
    const list = doc.createElement('div');
    list.className = 'tabletop-gallery__list';
    panel.appendChild(list);
    const all = this.host.cutscenes(home);
    if (all.length === 0) this.span(list, 'tabletop-gallery__empty', 'No cutscenes in this scene yet. Press + to make one.');
    for (const c of all) list.appendChild(this.galleryRow(home, c));
  }

  private galleryRow(home: string, c: Cutscene): HTMLElement {
    const row = this.root.ownerDocument.createElement('div');
    row.className = 'tabletop-gallery__row';
    row.dataset.cutsceneId = c.id;
    const label = this.span(row, 'tabletop-gallery__name', c.name);
    label.setAttribute('aria-label', `${c.name}: double-click to rename`);
    label.addEventListener('dblclick', (event) => { event.stopPropagation(); void this.rename(home, c); });
    this.span(row, 'tabletop-gallery__count', c.shots.length === 0 ? 'No shots yet' : c.shots.length === 1 ? '1 shot' : `${c.shots.length} shots`);
    const actions = this.root.ownerDocument.createElement('div');
    actions.className = 'tabletop-gallery__actions';
    row.appendChild(actions);
    if (this.confirming === c.id) {
      this.span(actions, 'tabletop-gallery__ask', 'Delete it?');
      this.button(actions, 'Delete', () => { this.confirming = null; this.host.remove(home, c.id); this.renderGallery(); }, 'mod-warning tabletop-gallery__yes');
      this.button(actions, 'Keep', () => { this.confirming = null; this.renderGallery(); }, 'tabletop-gallery__no');
      return row;
    }
    // A cutscene with no shots cannot be played: Play for players and Preview say why they are off.
    const empty = c.shots.length === 0;
    // Played for players through Connect: off (and saying why on hover) without a session, or without shots.
    const session = this.host.session();
    const why = session?.hosting() !== true ? NO_SESSION : session.cutscenes !== true ? OLD_CONNECT : empty ? NO_SHOTS : null;
    const play = this.iconButton(actions, 'play', why ?? 'Play for players', () => { if (!why) void this.play(c.id); }, 'tabletop-gallery__play mod-cta');
    if (why) {
      play.setAttribute('aria-disabled', 'true');
      play.classList.add('is-disabled');
    }
    this.iconButton(actions, 'pencil', 'Edit', () => this.edit(c.id), 'tabletop-gallery__edit');
    const preview = this.iconButton(actions, 'eye', empty ? NO_SHOTS : 'Preview from the start', () => { this.edit(c.id); this.preview(0); }, 'tabletop-gallery__preview');
    preview.disabled = empty;
    if (empty) { preview.title = NO_SHOTS; row.classList.add('tabletop-gallery__row--empty'); }
    this.iconButton(actions, 'trash-2', 'Delete', () => { this.confirming = c.id; this.renderGallery(); }, 'tabletop-gallery__delete');
    return row;
  }

  /** The cinematic settings: bars, aspect, the default transition and the length of a fade. */
  private settingsForm(): HTMLElement {
    const doc = this.root.ownerDocument;
    const settings = this.host.settings();
    const form = doc.createElement('div');
    form.className = 'tabletop-gallery__settings';
    const field = (label: string, build: (into: HTMLElement) => void): void => {
      const row = doc.createElement('label');
      row.className = 'tabletop-gallery__field';
      this.span(row, '', label);
      build(row);
      form.appendChild(row);
    };
    field('Cinematic bars', (into) => {
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = settings.bars;
      box.dataset.setting = 'bars';
      box.addEventListener('change', () => this.changeSettings({ bars: box.checked }));
      into.appendChild(box);
    });
    const choose = (key: 'aspect' | 'transition', options: ReadonlyArray<[string, string]>, current: string, apply: (value: string) => Partial<CinematicSettings>): void => {
      field(key === 'aspect' ? 'Aspect ratio' : 'Default transition', (into) => {
        const select = doc.createElement('select');
        select.dataset.setting = key;
        for (const [value, text] of options) {
          const option = doc.createElement('option');
          option.value = value;
          option.textContent = text;
          select.appendChild(option);
        }
        select.value = current;
        select.addEventListener('change', () => this.changeSettings(apply(select.value)));
        into.appendChild(select);
      });
    };
    choose('aspect', CINEMATIC_ASPECTS.map((a) => [String(a), `${a}:1`]), String(settings.aspect), (value) => ({ aspect: Number(value) as CinematicAspect }));
    choose('transition', [['fade', 'Fade'], ['cut', 'Cut'], ['move', 'Move']], settings.transition, (value) => ({ transition: value as Transition }));
    field('Fade length (seconds each way)', (into) => {
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = String(MIN_FADE_MS / 1000);
      input.max = String(MAX_FADE_MS / 1000);
      input.step = '0.1';
      input.value = String(settings.fadeMs / 1000);
      input.dataset.setting = 'fadeMs';
      input.addEventListener('change', () => {
        const seconds = Number(input.value);
        if (Number.isFinite(seconds)) this.changeSettings({ fadeMs: Math.round(seconds * 1000) });
        input.value = String(this.host.settings().fadeMs / 1000);
      });
      into.appendChild(input);
    });
    return form;
  }

  private changeSettings(changes: Partial<CinematicSettings>): void {
    this.host.setSettings(changes);
    if (this.session) this.applyBars();
  }

  /** `+`: asks a name, keeps the empty cutscene at once and opens it. */
  async create(): Promise<void> {
    const home = this.host.mapPath();
    if (!home || (this.state !== 'idle' && this.state !== 'gallery')) return;
    const name = (await this.host.askName('Cutscene'))?.trim();
    if (!name || this.session || this.host.mapPath() !== home) return;
    const made: Cutscene = { id: newId('cutscene'), name, shots: [] };
    this.host.save(home, made);
    this.begin(home, made);
  }

  private async rename(home: string, c: Cutscene): Promise<void> {
    const name = (await this.host.askName(c.name))?.trim();
    if (!name || name === c.name) return;
    this.host.save(home, { ...c, name });
    this.renderGallery();
  }

  // ── Editing ──────────────────────────────────────────────────────────────

  /** Opens a cutscene of the current map in the editor. */
  edit(id: string): void {
    const home = this.host.mapPath();
    const found = home ? this.host.cutscenes(home).find((c) => c.id === id) : undefined;
    if (!home || !found || this.session) return;
    this.begin(home, found);
  }

  private begin(home: string, cutscene: Cutscene): void {
    const board = this.board;
    if (!board || this.session || this.leaving) return;
    this.closeGallery(true);
    // The free camera starts where the board's camera is; the board's own is kept to be put back.
    const pose = board.cameraPose();
    const free = new FreeCamera(pose.eye, pose.target);
    const driver: CinematicDriver = { free, pose: () => ({ ...(driver.free ?? free).pose(), black: 0 }) };
    this.session = { home, cutscene, keep: board.keepCamera(), driver, preview: null };
    this.applyBoard();
    this.showEditor();
    this.board?.refreshToolbar();
  }

  /** Puts the session's role and driver, the bars and the hold on the board at hand. */
  private applyBoard(): void {
    const session = this.session;
    const board = this.board;
    if (!session || !board) return;
    const preview = session.preview;
    board.setCinematicRole(preview ? 'previewing' : 'authoring');
    board.setCinematic(preview ? preview.driver : session.driver);
    this.applyBars();
    this.root.classList.add(AUTHORING);
    this.host.holdPlayers(true);
  }

  private applyBars(): void {
    const settings = this.host.settings();
    this.board?.cinema.setBars(settings.bars ? settings.aspect : null);
  }

  /**
   * What a shot sees, as a small picture: drawn from the board when the shot looks at the place the board shows (null
   * otherwise: another map or level is not loaded), kept while the shot, its place and the bars' aspect stay the same.
   */
  private thumbnail(shot: Shot): string | null {
    const board = this.board;
    const place = placeOf(shot);
    const aspect = this.host.settings().aspect;
    const key = JSON.stringify([shot.id, place, shot.eye, shot.target, aspect]);
    if (this.thumbs.has(key)) return this.thumbs.get(key)!;
    if (!board || !this.host.at(place)) return null;
    const width = 96;
    const height = Math.max(24, Math.round(width / (aspect > 0 ? aspect : 16 / 9)));
    const picture = board.shotThumbnail({ eye: shot.eye, target: shot.target }, width, height);
    if (this.thumbs.size > 400) this.thumbs.clear();
    this.thumbs.set(key, picture);
    return picture;
  }

  private showEditor(): void {
    const session = this.session;
    if (!session) return;
    const preview = session.preview !== null;
    this.timeline.hidden = false;
    this.timeline.el.classList.toggle('tabletop-timeline--previewing', preview);
    this.preBar.hidden = !preview;
    this.preBar.classList.toggle('tabletop-preview--with-timeline', preview);
    if (preview) {
      this.updatePreviewBar();
      return;
    }
    const c = session.cutscene;
    this.title.textContent = c.name;
    this.hint.textContent = c.shots.length === 0 ? 'Click the timeline to add a shot.' : 'Click: add a shot. Right-click a shot or between two shots for more.';
    // No shots, nothing to play: Preview is off, and says why.
    this.previewButton.disabled = c.shots.length === 0;
    this.previewButton.title = c.shots.length === 0 ? NO_SHOTS : 'Preview from the start';
    this.timeline.render(c, { home: session.home, mapName: mapLabel, thumbnail: (shot) => this.thumbnail(shot) });
  }

  /**
   * The session with its cutscene read again from the host: a rename or a delete of a map a shot is on rewrites the
   * saved cutscene while it is open, and the next edit must start from that. Null (and the editor is left) when the
   * cutscene is gone.
   */
  private synced(): Session | null {
    const session = this.session;
    if (!session) return null;
    const saved = this.host.cutscenes(session.home).find((c) => c.id === session.cutscene.id);
    if (!saved) {
      if (!this.leaving) {
        this.host.notice('Tabletop: this cutscene no longer exists.');
        this.stopEditing();
      }
      return null;
    }
    session.cutscene = saved;
    return session;
  }

  /** Applies an edit to the cutscene being edited and keeps the result; false when the edit changed nothing. */
  private amend(change: (c: Cutscene) => Cutscene): boolean {
    if (!this.session || this.session.preview || this.leaving) return false;
    const session = this.synced();
    if (!session) return false;
    const next = change(session.cutscene);
    if (next === session.cutscene) return false;
    session.cutscene = next;
    this.host.save(session.home, next);
    this.showEditor();
    this.focusBoard();
    return true;
  }

  private addAt(at: number): void {
    const session = this.session;
    if (!session || session.preview) return;
    const { eye, target } = (session.driver.free as FreeCamera).pose();
    const here = this.host.place() ?? session.home;
    const added = this.amend((c) => addShot(c, { id: newId('shot'), at, mapPath: mapOfPlace(here), level: levelOfPlace(here), eye, target }, this.host.settings().transition));
    if (added) return;
    const count = this.session?.cutscene.shots.length ?? 0;
    if (count >= MAX_SHOTS) this.host.notice(`Tabletop: a cutscene holds at most ${MAX_SHOTS} shots.`);
    else if (at > MAX_AT_MS) this.host.notice('Tabletop: a cutscene lasts at most 1 hour.');
    else this.host.notice('Tabletop: a shot cannot go that close to another one (at least 0.1 s apart), or the camera is too far from the map.');
  }

  /** Puts the free camera on a shot (switching to its map when it is on another). */
  private async goTo(shotId: string): Promise<void> {
    if (!this.session || this.session.preview || this.leaving) return;
    const session = this.synced();
    const shot = session?.cutscene.shots.find((candidate) => candidate.id === shotId);
    if (!session || !shot) return;
    session.driver.free = new FreeCamera(shot.eye, shot.target);
    if (!this.host.at(placeOf(shot))) {
      if (!this.host.mapTabs().includes(shot.mapPath)) this.host.notice(`Tabletop: ${mapLabel(shot.mapPath)} is not open in an Atlas tab.`);
      else {
        try {
          await this.host.showPlace(placeOf(shot));
        } catch (error) {
          console.warn('Tabletop: the map could not be shown:', error);
          this.host.notice(`Tabletop: ${mapLabel(shot.mapPath)} could not be shown.`);
        }
      }
    }
    this.focusBoard();
  }

  private shotMenu(shotId: string, x: number, y: number): void {
    if (!this.session || this.session.preview || this.leaving) return;
    const session = this.synced();
    const index = session?.cutscene.shots.findIndex((shot) => shot.id === shotId) ?? -1;
    if (!session || index < 0) return;
    const shot = session.cutscene.shots[index];
    const items: MenuItem[] = [
      { label: shot.keyframe ? 'Make ordinary shot' : 'Make keyframe shot', run: () => this.amend((c) => setKeyframe(c, shotId, !shot.keyframe)) },
      { label: 'Preview from here', run: () => this.preview(index) },
      {
        label: 'Update to current camera',
        run: () => {
          const { eye, target } = (session.driver.free as FreeCamera).pose();
          const here = this.host.place() ?? session.home;
          this.amend((c) => updateShot(c, shotId, { mapPath: mapOfPlace(here), level: levelOfPlace(here), eye, target }));
        },
      },
      { label: 'Delete', run: () => this.amend((c) => removeShot(c, shotId)) },
    ];
    this.menu.show(items, x, y);
  }

  /** The transition into a shot: fade, cut or move, the current one ticked; a move needs both shots on one map. */
  private gapMenu(shotId: string, x: number, y: number): void {
    if (!this.session || this.session.preview || this.leaving) return;
    const session = this.synced();
    const shots = session?.cutscene.shots ?? [];
    const index = shots.findIndex((shot) => shot.id === shotId);
    if (!session || index < 1) return;
    const allowed = allowedTransitions(shots[index - 1], shots[index]);
    const items: MenuItem[] = (['fade', 'cut', 'move'] as const).map((transition) => ({
      label: transition === 'fade' ? 'Fade' : transition === 'cut' ? 'Cut' : 'Move',
      checked: shots[index].transition === transition,
      disabled: allowed.includes(transition) ? false : 'A move needs both shots on the same map.',
      run: () => this.amend((c) => setTransition(c, shotId, transition)),
    }));
    this.menu.show(items, x, y);
  }

  /** Leaves the editor: the board's role, driver, bars and camera as they were, and the players' window free again. */
  stopEditing(): void {
    if (!this.session || this.leaving) return;
    void this.leave();
  }

  private async leave(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.leaving = true;
    this.menu.close();
    this.timeline.hidden = true;
    this.preBar.hidden = true;
    let home = this.host.mapPath() === session.home;
    try {
      if (!home) {
        home = await this.host.showPlace(session.home);
        if (!home) this.host.notice(`Tabletop: ${mapLabel(session.home)} is not open in an Atlas tab; staying on this map.`);
      }
    } catch (error) {
      home = false;
      console.warn('Tabletop: the map could not be shown:', error);
      this.host.notice(`Tabletop: ${mapLabel(session.home)} could not be shown; staying on this map.`);
    } finally {
      // Whatever happened, the board is unlocked, the players' picture is let go and Escape works again.
      const board = this.board;
      if (board) {
        board.setCinematic(null);
        board.setCinematicRole('none');
        board.cinema.setBars(null);
        if (home) board.restoreCamera(session.keep);
      }
      this.root.classList.remove(AUTHORING);
      this.host.holdPlayers(false);
      this.session = null;
      this.leaving = false;
      this.mode = 'idle';
      this.board?.refreshToolbar();
    }
  }

  /** A map was renamed in the vault: a session open on it (or previewing from it) follows. */
  mapRenamed(from: string, to: string): void {
    const session = this.session;
    if (!session) return;
    if (session.home === from) session.home = to;
    if (session.preview?.editMap && mapOfPlace(session.preview.editMap) === from) session.preview.editMap = `${to}${session.preview.editMap.slice(from.length)}`;
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  /** Plays the cutscene on this board alone, from the start or from a shot. */
  preview(fromShot = 0): void {
    if (!this.session || this.session.preview || this.leaving) return;
    const session = this.synced();
    if (!session) return;
    const shots = session.cutscene.shots;
    if (shots.length === 0) {
      this.host.notice('Tabletop: add a shot first.');
      return;
    }
    this.menu.close();
    const run = new CutscenePlayback(placed(session.cutscene), fromShot);
    const preview: Preview = {
      run,
      clock: 0,
      lastNow: null,
      switching: false,
      failed: new Set(),
      editMap: this.host.place(),
      driver: { pose: (now) => this.previewPose(preview, now) },
    };
    session.preview = preview;
    this.applyBoard();
    this.showEditor();
  }

  /** The preview's camera for this frame. The clock stands still while a map is loading, and the picture is black. */
  private previewPose(preview: Preview, nowMs: number): { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; black: number } {
    if (preview.lastNow !== null && !preview.switching) preview.clock += nowMs - preview.lastNow;
    preview.lastNow = nowMs;
    const at = preview.run.frame(preview.clock);
    if (!preview.switching && !this.host.at(at.mapPath) && !preview.failed.has(at.mapPath)) this.switchFor(preview, at.mapPath);
    return { eye: at.eye, target: at.target, black: preview.switching ? 1 : at.black };
  }

  /** The shot the run is at looks at another place (a map, or a level of this one): show it (at the black midpoint of a fade, or at once for a cut). */
  private switchFor(preview: Preview, path: string): void {
    if (!this.host.mapTabs().includes(mapOfPlace(path))) {
      preview.failed.add(path);
      this.host.notice(`Tabletop: ${mapLabel(path)} is not open in an Atlas tab, so the preview stays on this map.`);
      return;
    }
    preview.switching = true;
    const done = (ok: boolean): void => {
      if (!ok) preview.failed.add(path);
      preview.switching = false;
      preview.lastNow = null;
    };
    this.host.showPlace(path).then(done, () => done(false));
  }

  private previewStep(forward: boolean): void {
    const preview = this.session?.preview;
    if (!preview || preview.switching) return;
    if (forward) {
      if (preview.run.next(preview.clock) === 'ended') {
        this.backToEditing();
        return;
      }
    } else {
      const to = preview.run.previousStop();
      if (to === undefined) return;
      const settings = this.host.settings();
      preview.run.jump(to, settings.transition, preview.clock, settings.fadeMs);
    }
    this.updatePreviewBar();
  }

  private updatePreviewBar(): void {
    const session = this.session;
    const run = session?.preview?.run;
    if (!session || !run) return;
    this.preLabel.textContent = `Shot ${run.shot + 1} of ${run.cutscene.shots.length}`;
    this.prePrevious.disabled = run.shot === 0;
    // The strip under the preview: every shot, the one the preview is at marked; a click cuts to a shot.
    this.title.textContent = session.cutscene.name;
    this.hint.textContent = 'Previewing: click a shot to cut to it.';
    this.previewButton.disabled = true;
    this.timeline.render(run.cutscene, { home: session.home, mapName: mapLabel, thumbnail: (shot) => this.thumbnail(shot), current: run.shot });
  }

  /** Cuts the preview to a shot clicked on its strip. */
  private previewTo(shotId: string): void {
    const preview = this.session?.preview;
    if (!preview || preview.switching) return;
    const index = preview.run.cutscene.shots.findIndex((shot) => shot.id === shotId);
    if (index < 0) return;
    const settings = this.host.settings();
    preview.run.jump(index, settings.transition, preview.clock, settings.fadeMs);
    this.updatePreviewBar();
  }

  /** Ends the preview: the free camera is back, on the map the editor was on. */
  private backToEditing(): void {
    const session = this.session;
    const preview = session?.preview;
    if (!session || !preview) return;
    session.preview = null;
    this.applyBoard();
    this.showEditor();
    if (preview.editMap && !this.host.at(preview.editMap)) void this.host.showPlace(preview.editMap);
    this.focusBoard();
  }

  // ── The board changed under the studio ───────────────────────────────────

  /** The board was replaced (a scene switch, a quality change): the new one gets its role, driver and bars. */
  mapChanged(): void {
    if (this.leaving) return;
    const session = this.session;
    if (!session && this.run.running) {
      this.run.mapChanged();
      return;
    }
    if (!session) {
      if (this.mode === 'gallery') this.renderGallery();
      return;
    }
    if (session.preview) {
      session.preview.switching = false;
      session.preview.lastNow = null;
    }
    this.applyBoard();
    this.showEditor();
  }

  // ── Keys ─────────────────────────────────────────────────────────────────

  private onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    // Only this board's own keys: not another pane's, and not a dialog's (the name modal, a menu).
    const doc = this.root.ownerDocument;
    const focus = doc.activeElement;
    const inside = (node: EventTarget | null): boolean => node instanceof Node && this.root.contains(node);
    const elsewhere = (node: EventTarget | null): boolean => node instanceof Node && node !== doc.body && node !== doc.documentElement && !this.root.contains(node);
    if (elsewhere(target) || (!inside(target) && elsewhere(focus))) return;
    if (doc.querySelector('.modal-container')) return;
    const state = this.state;
    if (event.key === 'Escape') {
      if (state === 'previewing') this.backToEditing();
      else if (state === 'editing') this.stopEditing();
      else if (state === 'gallery') this.closeGallery();
      else return;
      event.preventDefault();
    } else if (state === 'previewing' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      this.previewStep(event.key === 'ArrowRight');
      event.preventDefault();
    }
  }

  dispose(): void {
    this.root.ownerDocument.defaultView?.removeEventListener('keydown', this.keys);
    this.menu.close();
    this.run.dispose();
    this.runBar.remove();
    this.runTimeline.dispose();
    const session = this.session;
    if (session) {
      const board = this.board;
      if (board) {
        board.setCinematic(null);
        board.setCinematicRole('none');
        board.cinema.setBars(null);
        board.restoreCamera(session.keep);
      }
      this.host.holdPlayers(false);
      this.session = null;
    }
    this.root.classList.remove(AUTHORING, CINEMATIC_MODE);
    this.board?.setCameraUnbound(false);
    this.gallery?.remove();
    this.gallery = null;
    this.timeline.dispose();
    this.preBar.remove();
    this.mode = 'idle';
  }
}
