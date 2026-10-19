// Just enough of Obsidian's runtime for the browser harness.
export const normalizePath = (path: string): string => path.split('/').filter(Boolean).join('/');
export class TFile {}
export class TFolder {}
export const setIcon = (): void => undefined;
