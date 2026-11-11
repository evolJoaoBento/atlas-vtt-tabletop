/** What Obsidian adds to every window and node (`node.win`, `win.createEl()` and friends), for the player board in a plain browser. */
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(element: Element, options?: string | { cls?: string | string[]; text?: string; attr?: Record<string, string> }): void {
  if (typeof options === 'string') element.className = options;
  else if (options) {
    if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
    if (options.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
  }
}

const documentOf = function (this: Window | undefined): Document { return (this ?? window).document; };
const target: Record<string, unknown> = {};
target.createEl = function (this: Window, tag: string, options?: never): HTMLElement {
  const made = documentOf.call(this).createElement(tag);
  apply(made, options);
  return made;
};
target.createDiv = function (this: Window, options?: never): HTMLElement {
  const made = documentOf.call(this).createElement('div');
  apply(made, options);
  return made;
};
target.createSpan = function (this: Window, options?: never): HTMLElement {
  const made = documentOf.call(this).createElement('span');
  apply(made, options);
  return made;
};
target.createSvg = function (this: Window, tag: string, options?: never): SVGElement {
  const made = documentOf.call(this).createElementNS(SVG_NS, tag);
  apply(made, options);
  return made as SVGElement;
};
/**
 * Obsidian gives every window, a popout's too, the create helpers, and every node its `win`. A window the harness opens
 * is another realm, so it is handed to this to get the same.
 */
export function equipWindow(win: Window): Window {
  const holder = win as unknown as Record<string, unknown>;
  for (const name of ['createEl', 'createDiv', 'createSpan', 'createSvg']) holder[name] ??= target[name];
  Object.defineProperty((win as unknown as { Node: typeof Node }).Node.prototype, 'win', {
    configurable: true,
    get(this: Node): Window {
      const doc = this.nodeType === Node.DOCUMENT_NODE ? (this as Document) : this.ownerDocument;
      return doc?.defaultView ?? win;
    },
  });
  return win;
}

equipWindow(window);
// Obsidian's own global helper, which `canvasTexture` and others use.
(globalThis as Record<string, unknown>).createEl ??= target.createEl;

const elementProto = HTMLElement.prototype as unknown as Record<string, unknown>;
elementProto.setCssStyles ??= function (this: HTMLElement, styles: Record<string, string>): void {
  Object.assign(this.style, styles);
};
elementProto.setCssProps ??= function (this: HTMLElement, props: Record<string, string>): void {
  for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
};

// Obsidian's globals for the window that has the focus.
(globalThis as unknown as { activeDocument: Document; activeWindow: Window }).activeDocument = document;
(globalThis as unknown as { activeDocument: Document; activeWindow: Window }).activeWindow = window;
// Obsidian's `node.doc`: the document a node belongs to.
if (!('doc' in Node.prototype)) Object.defineProperty(Node.prototype, 'doc', { get(this: Node) { return this.ownerDocument ?? document; } });

// Obsidian's element helpers: a child made and appended, emptied, classes and text set.
const nodeProto = Element.prototype as unknown as Record<string, unknown>;
const child = (tag: string) => function (this: Element, options?: never): Element {
  const made = this.ownerDocument.createElement(tag);
  apply(made, options);
  this.appendChild(made);
  return made;
};
nodeProto.createEl ??= function (this: Element, tag: string, options?: never): Element { return child(tag).call(this, options); };
nodeProto.createDiv ??= child('div');
nodeProto.createSpan ??= child('span');
nodeProto.createSvg ??= function (this: Element, tag: string, options?: never): Element {
  const made = this.ownerDocument.createElementNS(SVG_NS, tag);
  apply(made, options);
  this.appendChild(made);
  return made;
};
nodeProto.empty ??= function (this: Element): void { this.replaceChildren(); };
nodeProto.addClass ??= function (this: Element, ...names: string[]): void { this.classList.add(...names); };
nodeProto.removeClass ??= function (this: Element, ...names: string[]): void { this.classList.remove(...names); };
nodeProto.toggleClass ??= function (this: Element, names: string | string[], on: boolean): void { for (const name of ([] as string[]).concat(names)) this.classList.toggle(name, on); };
nodeProto.hasClass ??= function (this: Element, name: string): boolean { return this.classList.contains(name); };
nodeProto.setText ??= function (this: Element, text: string): void { this.textContent = text; };
nodeProto.setAttr ??= function (this: Element, name: string, value: string | number | boolean | null): void { if (value === null) this.removeAttribute(name); else this.setAttribute(name, String(value)); };
nodeProto.detach ??= function (this: Element): void { this.remove(); };
