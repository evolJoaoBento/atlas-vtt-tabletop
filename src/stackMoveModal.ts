/**
 * The ask before older Tabletop's scene stacks become Atlas levels (`stackMigration.ts`): what each stack would
 * become, what would not be kept, and Move or Later. Nothing is moved before Move is pressed; Later leaves every
 * stack as it is, to be asked about again at the next start.
 */
import { Modal, Setting, type App } from 'obsidian';
import type { StackMigration, StackOutcome } from './stackMigration';

const baseName = (path: string): string => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');

export class StackMoveModal extends Modal {
  constructor(app: App, private readonly migration: StackMigration, private readonly done: () => void = () => undefined) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Scene stacks to Atlas levels');
    void this.ask();
  }

  private list(outcomes: readonly StackOutcome[], moved: boolean): void {
    for (const outcome of outcomes) {
      const block = this.contentEl.createDiv({ cls: 'atlas-tabletop-stack-move' });
      block.createEl('h4', { text: baseName(outcome.base) });
      if (outcome.skipped) block.createEl('p', { text: `${moved ? 'Not moved' : 'Cannot be moved'}: ${outcome.skipped}.` });
      else block.createEl('p', { text: `${moved ? 'Moved. Its levels' : 'Its levels will be'}, lowest first: ${outcome.levels.join(', ')}.` });
      if (outcome.lost.length > 0) {
        block.createEl('p', { text: moved ? 'Not kept:' : 'Will not be kept:' });
        const lines = block.createEl('ul');
        for (const line of outcome.lost) lines.createEl('li', { text: line });
      }
    }
  }

  private async ask(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: 'Scenes stacked in Tabletop (elevation layers) become levels of their base scene in Atlas: one scene with floors, which Atlas, its players and the 3D board all show. The stacked scenes stay as scenes of their own; a backup of every scene and of Tabletop\'s data for it is written first. Until a stack is moved it is not drawn stacked any more.' });
    const reading = contentEl.createEl('p', { text: 'Reading the scenes…' });
    let outcomes: StackOutcome[] = [];
    try {
      outcomes = await this.migration.preview();
    } catch (error) {
      reading.setText(`The scenes could not be read: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    reading.remove();
    if (outcomes.length === 0) {
      contentEl.createEl('p', { text: 'There are no scene stacks to move.' });
      new Setting(contentEl).addButton((button) => button.setButtonText('Close').onClick(() => this.close()));
      return;
    }
    this.list(outcomes, false);
    contentEl.createEl('p', { text: 'Atlas will show each of these scenes for a moment while they are read, then the scene it shows now again.' });
    const buttons = new Setting(contentEl);
    buttons.addButton((button) => button.setButtonText('Move').setCta().setDisabled(outcomes.every((outcome) => outcome.skipped !== null)).onClick(() => { void this.move(); }));
    buttons.addButton((button) => button.setButtonText('Later').onClick(() => this.close()));
  }

  private async move(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    const working = contentEl.createEl('p', { text: 'Moving… Atlas goes through the scenes; leave it to it for a moment.' });
    let text = '';
    try {
      const { outcomes, backup, refused } = await this.migration.move();
      working.remove();
      if (refused) text = `Nothing was moved: ${refused}.`;
      else {
        this.list(outcomes, true);
        text = backup ? `Backup, with a note of what was done: ${backup}/` : 'There was nothing to move.';
      }
    } catch (error) {
      working.remove();
      text = `The move stopped: ${error instanceof Error ? error.message : String(error)}. What was not moved is as it was.`;
    }
    contentEl.createEl('p', { text });
    new Setting(contentEl).addButton((button) => button.setButtonText('Close').setCta().onClick(() => this.close()));
    this.done();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
