/** What Obsidian adds to every window and node (`node.win`, `win.createEl()` and friends), for the plain browser the harness runs in. */
const SVG_NS = 'http://www.w3.org/2000/svg';

Object.defineProperty(Node.prototype, 'win', {
  configurable: true,
  get(this: Node): Window {
    const doc = this instanceof Document ? this : this.ownerDocument;
    return doc?.defaultView ?? window;
  },
});

function apply(element: Element, options?: string | { cls?: string | string[]; text?: string; attr?: Record<string, string> }): void {
  if (typeof options === 'string') element.className = options;
  else if (options) {
    if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
    if (options.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
  }
}

const target = window as unknown as Record<string, unknown>;
const documentOf = function (this: Window | undefined): Document { return (this ?? window).document; };
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
// Obsidian's own global helper, which `canvasTexture` and others use.
(globalThis as Record<string, unknown>).createEl ??= target.createEl;

const elementProto = HTMLElement.prototype as unknown as Record<string, unknown>;
elementProto.setCssStyles ??= function (this: HTMLElement, styles: Record<string, string>): void {
  Object.assign(this.style, styles);
};
elementProto.setCssProps ??= function (this: HTMLElement, props: Record<string, string>): void {
  for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
};
