// Just enough of Obsidian's runtime for the unit tests (the package ships types only). Tests build their own fakes of the
// vault and workspace; files and folders are these classes so `instanceof` checks in the code under test work.
export const normalizePath = (path: string): string => path.split('/').filter(Boolean).join('/');

export class TAbstractFile {
  constructor(public path: string) {}
  get name(): string { return this.path.split('/').pop() ?? ''; }
}

export class TFile extends TAbstractFile {
  get extension(): string { return this.name.includes('.') ? this.name.split('.').pop() ?? '' : ''; }
  get basename(): string { return this.name.replace(/\.[^.]*$/, ''); }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class Notice {
  constructor(public message: string) {}
}

// Obsidian's YAML helpers (it bundles the same `yaml` library Atlas uses).
export { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
export const requireApiVersion = (): boolean => true;
export class Component { load(): void {} unload(): void {} addChild<T>(child: T): T { return child; } register(): void {} registerEvent(): void {} }
export class View extends Component {}
export class BasesView extends View {}
export const MarkdownRenderer = { render: async (): Promise<void> => {} };
export const Platform = { isMacOS: false, isMobile: false, isDesktop: true, isWin: true };
// Named by the panels Atlas's board tools pull in (`BoardAtlasTools`); nothing in the unit tests calls them.
export const setIcon = (): void => {};
export const base64ToArrayBuffer = (base64: string): ArrayBuffer => { const bytes = Buffer.from(base64, 'base64'); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };
export class Scope {}
export class Modal {}
export const Keymap = { isModEvent: (): boolean => false };
