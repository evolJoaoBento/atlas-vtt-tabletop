// Just enough of Obsidian for the player board in a plain browser (Connect's join page): nothing here is called on that path.
export const normalizePath = (path: string): string => path.split('/').filter(Boolean).join('/');
export class TAbstractFile {
  constructor(public path = '') {}
  get name(): string { return this.path.split('/').pop() ?? ''; }
}
export class TFile extends TAbstractFile {
  get extension(): string { return this.name.includes('.') ? this.name.split('.').pop() ?? '' : ''; }
  get basename(): string { return this.name.replace(/\.[^.]*$/, ''); }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}
export const setIcon = (): void => undefined;
export class Component { load(): void {} unload(): void {} addChild<T>(child: T): T { return child; } register(): void {} registerEvent(): void {} }
export class View extends Component {}
export class BasesView extends View {}
export const MarkdownRenderer = { render: async (): Promise<void> => {} };
export const requireApiVersion = (): boolean => true;
export const parseYaml = (text: string): unknown => JSON.parse(text || 'null');
export const stringifyYaml = (value: unknown): string => JSON.stringify(value);
/** A notice goes to the console: the page has no notice area of Tabletop's. */
export class Notice {
  constructor(message: string) { console.info(message); }
}
export class Scope { register(): unknown { return {}; } unregister(): void {} }
export class Modal extends Component { contentEl = document.createElement('div'); modalEl = document.createElement('div'); constructor(public app: unknown) { super(); } open(): void {} close(): void {} }
export const Keymap = { isModEvent: (): boolean => false, isModifier: (): boolean => false };
export const Platform = { isMacOS: false, isMobile: false, isDesktop: true, isWin: true };
export const base64ToArrayBuffer = (text: string): ArrayBuffer => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;
