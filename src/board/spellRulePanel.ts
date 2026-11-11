/**
 * The GM's review of what a cast spell would do to tokens (`spellRules.ts`): its title, one line per token with a tick
 * (whom it applies to: a push only moves those who failed their save), and Apply / Skip. Pure DOM over the board; the
 * board says what to do with the ticked ones. One shown at a time; more wait their turn.
 */
export interface RuleLine {
  id: string;
  words: string;
  /** Ticked to begin with. */
  on: boolean;
}

export interface RuleReview {
  title: string;
  note?: string;
  lines: RuleLine[];
  apply: string;
  /** With the ids ticked. */
  run(ids: string[]): void;
  /** Skipped (or closed). */
  skip?(): void;
}

export class SpellRulePanel {
  private readonly queue: RuleReview[] = [];
  private element: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  /** Whether a review is showing. */
  get showing(): boolean {
    return this.element !== null;
  }

  /** The title of the review showing (for tests). */
  get title(): string | null {
    return this.element?.querySelector('.atlas-tabletop-spellpicker__title')?.textContent ?? null;
  }

  offer(review: RuleReview): void {
    this.queue.push(review);
    if (!this.element) this.next();
  }

  /** Runs the review showing with what is ticked (as Apply would). */
  applyShowing(): void {
    (this.element?.querySelector('[data-rule-apply]') as HTMLButtonElement | null)?.click();
  }

  dispose(): void {
    this.queue.length = 0;
    this.element?.remove();
    this.element = null;
  }

  private next(): void {
    this.element?.remove();
    this.element = null;
    const review = this.queue.shift();
    if (!review) return;
    const doc = this.root.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'atlas-tabletop-spellpicker atlas-tabletop-spellrules';
    panel.addEventListener('keydown', (event) => event.stopPropagation());
    panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    const head = doc.createElement('div');
    head.className = 'atlas-tabletop-spellpicker__head';
    head.append(Object.assign(doc.createElement('div'), { className: 'atlas-tabletop-spellpicker__title', textContent: review.title }));
    panel.append(head);
    if (review.note) panel.append(Object.assign(doc.createElement('div'), { className: 'atlas-tabletop-spellpicker__note', textContent: review.note }));
    const boxes: Array<{ id: string; input: HTMLInputElement }> = [];
    if (review.lines.length > 0) {
      const list = doc.createElement('div');
      list.className = 'atlas-tabletop-spellrules__lines';
      for (const line of review.lines) {
        const label = doc.createElement('label');
        const input = doc.createElement('input');
        input.type = 'checkbox';
        input.checked = line.on;
        input.dataset.ruleLine = line.id;
        label.append(input, Object.assign(doc.createElement('span'), { textContent: line.words }));
        list.append(label);
        boxes.push({ id: line.id, input });
      }
      panel.append(list);
    }
    const actions = doc.createElement('div');
    actions.className = 'atlas-tabletop-spellpicker__actions';
    const apply = Object.assign(doc.createElement('button'), { type: 'button', textContent: review.apply, className: 'mod-cta' });
    apply.dataset.ruleApply = '';
    apply.addEventListener('click', () => { review.run(boxes.filter((box) => box.input.checked).map((box) => box.id)); this.next(); });
    const skip = Object.assign(doc.createElement('button'), { type: 'button', textContent: 'Skip' });
    skip.dataset.ruleSkip = '';
    skip.addEventListener('click', () => { review.skip?.(); this.next(); });
    actions.append(apply, skip);
    panel.append(actions);
    this.root.append(panel);
    this.element = panel;
  }
}
