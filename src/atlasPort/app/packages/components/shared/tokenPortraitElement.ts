// Atlas source: src/app/packages/components/shared/tokenPortraitElement.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
// (stylesheet ./token-portrait.scss: in Atlas's styles.css);

interface TokenPortraitElementOptions {
  src: string;
  alt: string;
  showRing: boolean;
  /** Tints the ring like the canvas does; untinted (white) when omitted. */
  ringColor?: string | undefined;
  cls?: string | undefined;
}

/** `TokenPortrait` for panels built with the DOM instead of React: the same elements and classes. */
export function createTokenPortrait(parent: HTMLElement, { src, alt, showRing, ringColor, cls }: TokenPortraitElementOptions): HTMLElement {
  const portrait = parent.createDiv({ cls: 'atlas-token-portrait' });
  if (!showRing) portrait.addClass('atlas-token-portrait--unframed');
  if (cls) portrait.addClass(cls);
  portrait.createDiv({ cls: 'atlas-token-image-wrapper' })
    .createEl('img', { attr: { src, alt, draggable: 'false', decoding: 'async' } });
  if (showRing) {
    const ring = portrait.createDiv({ cls: 'atlas-token-ring' });
    if (ringColor) ring.style.setProperty('--atlas-token-ring-color', ringColor);
  }
  return portrait;
}
