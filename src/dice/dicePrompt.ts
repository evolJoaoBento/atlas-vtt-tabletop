/**
 * The line over the board telling the thrower what the roll waits on (caught dice, explosions to throw), with a Throw
 * for them (an explosion has no die to click), or a short notice with nothing to throw that goes by itself. Shared by
 * the GM's board and a Connect player's.
 */

/** How long a notice stays. */
export const NOTICE_MS = 5000;

export class DicePrompt {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly button: HTMLButtonElement;
  private timer = 0;

  constructor(container: HTMLElement, onThrow: () => void) {
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'atlas-tabletop-dice-prompt';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.text = doc.createElement('span');
    this.text.className = 'atlas-tabletop-dice-prompt__text';
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.className = 'atlas-tabletop-dice-prompt__throw';
    this.button.textContent = 'Throw';
    this.button.addEventListener('click', () => onThrow());
    this.root.append(this.text, this.button);
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    container.appendChild(this.root);
  }

  /** What the roll waits on, with its Throw; null hides the line. A notice showing goes. */
  show(text: string | null): void {
    this.set(text, false);
  }

  /** A message with nothing to throw, gone after `NOTICE_MS` or at the next line. */
  notice(text: string): void {
    this.set(text, true);
    this.timer = this.root.ownerDocument.defaultView?.setTimeout(() => this.set(null, false), NOTICE_MS) ?? 0;
  }

  dispose(): void {
    this.set(null, false);
    this.root.remove();
  }

  private set(text: string | null, notice: boolean): void {
    if (this.timer) this.root.ownerDocument.defaultView?.clearTimeout(this.timer);
    this.timer = 0;
    this.text.textContent = text ?? '';
    this.button.hidden = notice;
    this.root.hidden = text === null;
  }
}
