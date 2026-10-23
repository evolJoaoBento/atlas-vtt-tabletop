/**
 * The line over the board telling the thrower what the roll waits on (dice to throw, caught dice, explosions), with
 * Throw all for them; once the roll is done, what it came to; or a short notice that goes by itself. Clear takes the
 * dice off the table. Shared by the GM's board and a Connect player's.
 */

/** How long a notice stays. */
export const NOTICE_MS = 5000;

export class DicePrompt {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private timer = 0;

  constructor(container: HTMLElement, onThrow: () => void, onClear?: () => void) {
    const doc = container.ownerDocument;
    this.root = doc.win.createDiv();
    this.root.className = 'atlas-tabletop-dice-prompt';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.text = doc.win.createSpan();
    this.text.className = 'atlas-tabletop-dice-prompt__text';
    this.button = doc.win.createEl('button');
    this.button.type = 'button';
    this.button.className = 'atlas-tabletop-dice-prompt__throw';
    this.button.textContent = 'Throw all';
    this.button.addEventListener('click', () => onThrow());
    this.clear = doc.win.createEl('button');
    this.clear.type = 'button';
    this.clear.className = 'atlas-tabletop-dice-prompt__clear';
    this.clear.textContent = 'Clear';
    this.clear.setAttribute('aria-label', 'Clear the dice off the table');
    this.clear.hidden = !onClear;
    this.clear.addEventListener('click', () => onClear?.());
    this.root.append(this.text, this.button, this.clear);
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    container.appendChild(this.root);
  }

  /** What the roll waits on, with Throw all; null hides the line. A notice showing goes. */
  show(text: string | null): void {
    this.set(text, 'throw');
  }

  /** What the finished roll came to, with nothing to throw: it stays while its dice lie on the table. */
  result(text: string): void {
    this.set(text, 'result');
  }

  /** A message with nothing to throw, gone after `NOTICE_MS` or at the next line. */
  notice(text: string): void {
    this.set(text, 'notice');
    this.timer = this.root.ownerDocument.defaultView?.setTimeout(() => this.set(null, 'throw'), NOTICE_MS) ?? 0;
  }

  /** The dice tray opened over the line, or closed again: the line hides while it is open. */
  setCovered(covered: boolean): void {
    this.root.classList.toggle('is-covered', covered);
  }

  dispose(): void {
    this.set(null, 'throw');
    this.root.remove();
  }

  private set(text: string | null, kind: 'throw' | 'result' | 'notice'): void {
    if (this.timer) this.root.ownerDocument.defaultView?.clearTimeout(this.timer);
    this.timer = 0;
    this.text.textContent = text ?? '';
    this.button.hidden = kind !== 'throw';
    this.root.hidden = text === null;
  }
}
