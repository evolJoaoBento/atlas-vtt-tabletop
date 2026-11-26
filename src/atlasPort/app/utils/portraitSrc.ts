// Atlas source: src/app/utils/portraitSrc.ts @ 0.20.0 (AGPL-3.0, hand-copied for Tabletop: the board's player window shows Atlas's own initiative list; only the imports differ).
// @ts-nocheck
import type { App } from 'obsidian';
import { isResourceUrl } from './pathUtils';

/** The address a portrait's image is shown from: a URL as it is, a vault path as its resource URL; null for none. */
export function portraitSrc(app: App, imagePath: string): string | null {
  if (!imagePath) return null;
  return /^(?:https?:|data:|blob:)/.test(imagePath) || isResourceUrl(imagePath) ? imagePath : app.vault.adapter.getResourcePath(imagePath);
}
