/** Asks the GM for a name in a small window: Enter or Save gives it, Cancel or closing the window gives null. */

import { Modal, type App } from 'obsidian';

class NameModal extends Modal {
  private answered = false;

  constructor(app: App, private readonly heading: string, private readonly initial: string, private readonly answer: (name: string | null) => void) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    const root = this.contentEl;
    const input = root.createEl('input', { type: 'text', value: this.initial, attr: { 'aria-label': 'Name' } });
    input.addClass('tabletop-name-input');
    const finish = (name: string | null): void => {
      if (this.answered) return;
      this.answered = true;
      this.close();
      this.answer(name);
    };
    const done = (): void => {
      const name = input.value.trim();
      if (name) finish(name);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        done();
      }
    });
    const row = root.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'Save', cls: 'mod-cta' }).addEventListener('click', done);
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => finish(null));
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.answered) {
      this.answered = true;
      this.answer(null);
    }
  }
}

export function askName(app: App, heading: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => new NameModal(app, heading, initial, resolve).open());
}
