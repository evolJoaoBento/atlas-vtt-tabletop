/**
 * Whether this window can draw the 3D board. A machine with WebGL off (a blocklisted card, a remote desktop, hardware
 * acceleration disabled in Obsidian) makes three.js throw while the board is being built, which leaves a blank tab; asked
 * first, the board says why instead, and Connect's players keep their 2D map. Pure apart from the canvas it is given.
 */

/** The part of a canvas the probe uses. */
export interface ProbeCanvas {
  getContext(kind: string): unknown;
}

/** Shown where the 3D board would be. */
export const NO_WEBGL_TITLE = '3D board unavailable';
export const NO_WEBGL_HELP = 'This window cannot use WebGL. Turn on hardware acceleration in Obsidian (Settings, General), update your graphics driver, or restart Obsidian, then reopen this tab.';

/** Whether a WebGL context can be made on a canvas of `make`; the probe context is given back at once (a window holds few). */
export function webglAvailable(make: () => ProbeCanvas): boolean {
  try {
    const gl = (() => {
      const canvas = make();
      return canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    })() as { getExtension?(name: string): { loseContext?(): void } | null } | null;
    if (!gl) return false;
    gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

/** The check for a document's window. */
export const documentHasWebgl = (doc: Document): boolean => webglAvailable(() => doc.win.createEl('canvas'));
