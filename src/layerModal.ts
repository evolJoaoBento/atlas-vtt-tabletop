/**
 * "Elevation layer…": stacks a scene on another one, a number of grid squares above it (an upper floor, a balcony, a
 * bridge). Opening either of them in 3D then shows the whole stack. The modal picks the base scene and the elevation;
 * the data is Tabletop's own (`BoardData.setLayer`), so the scene files are not touched.
 */
import { Modal, Notice, Setting, type App } from 'obsidian';
import type { BoardData } from './board/boardData';

const baseName = (path: string): string => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');

export class LayerModal extends Modal {
  private base: string;
  private elevation: number;

  constructor(app: App, private readonly data: BoardData, private readonly mapPath: string, private readonly maps: readonly string[]) {
    super(app);
    const current = data.layerOf(mapPath);
    this.base = current?.base ?? maps.find((path) => path !== mapPath) ?? '';
    this.elevation = current?.elevation ?? 1;
  }

  onOpen(): void {
    this.setTitle(`Elevation layer: ${baseName(this.mapPath)}`);
    const others = this.maps.filter((path) => path !== this.mapPath && this.data.layersOf(this.mapPath).length === 0);
    if (others.length === 0) {
      this.contentEl.createEl('p', { text: this.data.layersOf(this.mapPath).length > 0 ? 'This scene has layers of its own, so it cannot be a layer of another.' : 'There is no other scene to stack this one on.' });
      return;
    }
    this.contentEl.createEl('p', { text: 'Stack this scene on another. Opening either in 3D shows both together, this one standing above the other by the elevation. Transparent parts of its image show what is below.', cls: 'setting-item-description' });
    new Setting(this.contentEl).setName('Stand on').setDesc('The scene underneath. A scene on a layer joins that layer\'s stack.').addDropdown((dropdown) => {
      for (const path of others) dropdown.addOption(path, baseName(path));
      dropdown.setValue(others.includes(this.base) ? this.base : others[0]!).onChange((value) => { this.base = value; });
      this.base = others.includes(this.base) ? this.base : others[0]!;
    });
    new Setting(this.contentEl).setName('Elevation').setDesc('Grid squares above that scene (0.5 and below are fine; negative goes under it).').addText((text) => {
      text.setValue(String(this.elevation)).onChange((value) => {
        const number = Number(value.replace(',', '.'));
        if (value.trim() !== '' && Number.isFinite(number)) this.elevation = number;
      });
      text.inputEl.inputMode = 'decimal';
    });
    const buttons = new Setting(this.contentEl);
    buttons.addButton((button) => button.setButtonText('Stack').setCta().onClick(() => {
      if (!this.data.setLayer(this.mapPath, this.base, this.elevation)) {
        new Notice('Tabletop: that scene cannot be stacked there.');
        return;
      }
      this.close();
    }));
    if (this.data.layerOf(this.mapPath)) {
      buttons.addButton((button) => button.setButtonText('Remove from stack').setWarning().onClick(() => {
        this.data.clearLayer(this.mapPath);
        this.close();
      }));
    }
    buttons.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
