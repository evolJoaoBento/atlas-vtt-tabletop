/**
 * "Ask for a spell…" on a token's menu (the GM, hosting with Connect): the spell the token's player is to cast, its
 * name, shape, where it starts and its sizes in squares. The player only aims it; Connect takes the cast as set here.
 * The last ask of each shape is kept for the next, for the session.
 */
import { Modal, Setting, type App } from 'obsidian';
import { SPELL_SHAPES, type SpellAsk, type SpellShape } from './board/spells';

interface Draft {
  name: string;
  shape: SpellShape;
  from: 'self' | 'point';
  /** Squares, as the form shows them. */
  size: number;
  length: number;
  longest: number;
}

const SHAPE_NAMES: Record<SpellShape, string> = { sphere: 'Sphere', cube: 'Cube', cylinder: 'Cylinder', cone: 'Cone', wall: 'Wall' };
const STARTS: Record<SpellShape, Draft> = {
  sphere: { name: '', shape: 'sphere', from: 'point', size: 4, length: 0, longest: 12 },
  cube: { name: '', shape: 'cube', from: 'point', size: 3, length: 0, longest: 12 },
  cylinder: { name: '', shape: 'cylinder', from: 'self', size: 1, length: 12, longest: 12 },
  cone: { name: '', shape: 'cone', from: 'self', size: 3, length: 0, longest: 12 },
  wall: { name: '', shape: 'wall', from: 'point', size: 1, length: 4, longest: 12 },
};
/** The last ask of each shape, and the shape last asked. */
const kept: { shape: SpellShape; drafts: Record<SpellShape, Draft> } = { shape: 'sphere', drafts: structuredClone(STARTS) };

const SIZE_NAMES: Record<SpellShape, string> = { sphere: 'Radius', cube: 'Side', cylinder: 'Radius', cone: 'Length', wall: 'Thickness' };

/** The ask in map pixels, from the form's squares. */
export function askOf(draft: Draft, cell: number): SpellAsk {
  const name = draft.name.trim();
  return {
    ...(name ? { name: name.slice(0, 60) } : {}),
    shape: draft.shape, from: draft.shape === 'wall' ? 'point' : draft.from, size: draft.size * cell,
    length: draft.shape === 'wall' || draft.shape === 'cylinder' ? draft.length * cell : 0,
    ...(draft.shape === 'wall' ? { longest: draft.longest * cell } : {}),
  };
}

export class SpellAskModal extends Modal {
  private draft: Draft;

  constructor(app: App, private readonly tokenName: string, private readonly cell: number, private readonly asking: SpellAsk | null, private readonly send: (ask: SpellAsk) => void, private readonly withdraw: (() => void) | null) {
    super(app);
    this.draft = { ...kept.drafts[kept.shape] };
  }

  onOpen(): void {
    this.setTitle(`Ask ${this.tokenName} for a spell`);
    this.draw();
  }

  private draw(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('p', { cls: 'setting-item-description', text: 'The token\'s player aims it through the token\'s eyes and casts it, or turns it down. Sizes are in grid squares.' });
    if (this.asking) root.createEl('p', { cls: 'setting-item-description', text: `Waiting now: ${this.asking.name ?? SHAPE_NAMES[this.asking.shape]}. Asking again replaces it.` });
    const draft = this.draft;
    new Setting(root).setName('Name').setDesc('What the player is told, e.g. Fireball.').addText((text) => {
      text.setPlaceholder('Spell').setValue(draft.name).onChange((value) => { draft.name = value; });
      text.inputEl.maxLength = 60;
    });
    new Setting(root).setName('Shape').addDropdown((dropdown) => {
      for (const shape of SPELL_SHAPES) dropdown.addOption(shape, SHAPE_NAMES[shape]);
      dropdown.setValue(draft.shape).onChange((value) => {
        kept.drafts[draft.shape] = { ...draft };
        this.draft = { ...kept.drafts[value as SpellShape], name: draft.name };
        this.draw();
      });
    });
    if (draft.shape !== 'wall') {
      new Setting(root).setName('Starts').setDesc(draft.from === 'self' ? 'From the token, the way it looks; walls stop it.' : 'At a point the token sees, centred there.').addDropdown((dropdown) => {
        dropdown.addOption('self', 'From the token').addOption('point', 'At a point').setValue(draft.from).onChange((value) => { draft.from = value as Draft['from']; this.draw(); });
      });
    }
    const squares = (name: string, key: 'size' | 'length' | 'longest'): void => {
      new Setting(root).setName(name).addText((text) => {
        text.setValue(String(draft[key])).onChange((value) => {
          const number = Number(value.replace(',', '.'));
          if (Number.isFinite(number) && number > 0 && number <= 100) draft[key] = number;
        });
        text.inputEl.inputMode = 'decimal';
        text.inputEl.setAttribute('data-spell-ask', key);
      });
    };
    squares(SIZE_NAMES[draft.shape], 'size');
    if (draft.shape === 'cylinder') squares('Length', 'length');
    if (draft.shape === 'wall') { squares('Height', 'length'); squares('Longest run', 'longest'); }
    const buttons = new Setting(root);
    buttons.addButton((button) => button.setButtonText('Ask').setCta().onClick(() => {
      kept.shape = draft.shape;
      kept.drafts[draft.shape] = { ...draft };
      this.close();
      this.send(askOf(draft, this.cell));
    }));
    if (this.withdraw) {
      const withdraw = this.withdraw;
      buttons.addButton((button) => button.setButtonText('Take back the ask').setWarning().onClick(() => { this.close(); withdraw(); }));
    }
    buttons.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
