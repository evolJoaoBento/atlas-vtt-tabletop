/** Fills an element with an icon from this plugin's own SVG strings, parsed rather than assigned as HTML. */
export function setSvg(target: Element, svg: string, append = false): void {
  const nodes: Node[] = [];
  if (svg) {
    const parsed = new DOMParser().parseFromString(svg, 'text/html').body.firstElementChild;
    if (parsed?.nodeName === 'svg') nodes.push(target.ownerDocument.importNode(parsed, true));
  }
  if (append) target.append(...nodes);
  else target.replaceChildren(...nodes);
}
