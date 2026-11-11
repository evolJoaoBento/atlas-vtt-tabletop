/**
 * The GM's review of what a cast spell would do to tokens (`spellRules.ts`): its title, one line per token with a tick
 * (whom it applies to: a push only moves those who failed their save), and Apply / Skip. Pure DOM over the board; the
 * board says what to do with the ticked ones. One shown at a time; more of the same cast wait their turn. A review
 * belongs to the cast it is about: a newer cast's review, a new cast begun, the caster closed or Escape dismisses the
 * old ones (as Skip), so a stale review never sits over the next cast.
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
  private readonly queue: Array<{ review: RuleReview; cast: string | null }> = [];
  private element: HTMLElement | null = null;
  /** The review showing, and the cast it is about. */
  private current: { review: RuleReview; cast: string | null } | null = null;

  constructor(private readonly root: HTMLElement) {}

  /** Whether a review is showing. */
  get showing(): boolean {
    return this.element !== null;
  }

  /** The title of the review showing (for tests). */
  get title(): string | null {
    return this.element?.querySelector('.atlas-tabletop-spellpicker__title')?.textContent ?? null;
  }

  /** Shows `review` (after the others of its cast); `cast` the spell it is about: reviews of any other are dismissed first. */
  offer(review: RuleReview, cast: string | null = null): void {
    if (cast !== null && [this.current, ...this.queue].some((each) => each !== null && each.cast !== cast)) this.dismiss();
    this.queue.push({ review, cast });
    if (!this.element) this.next();
  }

  /** Takes every review away, unanswered (as Skip): a new cast begins, the caster closed, or Escape. */
  dismiss(): void {
    const dropped = [...(this.current ? [this.current] : []), ...this.queue.splice(0)];
    this.current = null;
    this.element?.remove();
    this.element = null;
    for (const each of dropped) each.review.skip?.();
  }

  /** Runs the review showing with what is ticked (as Apply would). */
  applyShowing(): void {
    (this.element?.querySelector('[data-rule-apply]') as HTMLButtonElement | null)?.click();
  }

  dispose(): void {
    this.queue.length = 0;
    this.current = null;
    this.element?.remove();
    this.element = null;
  }

  private next(): void {
    this.element?.remove();
    this.element = null;
    this.current = this.queue.shift() ?? null;
    if (!this.current) return;
    const { review } = this.current;
    const doc = this.root.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'atlas-tabletop-spellpicker atlas-tabletop-spellrules';
    panel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.dismiss(); }
    });
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
