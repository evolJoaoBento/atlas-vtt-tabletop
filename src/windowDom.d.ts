/** Obsidian puts its element helpers on every window, popouts included; its typings only declare them as globals. */
interface Window {
  createEl: typeof createEl;
  createDiv: typeof createDiv;
  createSpan: typeof createSpan;
  createSvg: typeof createSvg;
}
