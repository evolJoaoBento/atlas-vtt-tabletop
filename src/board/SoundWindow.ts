/**
 * Atlas's Sound page on the 3D board. Not a copy: Atlas registers the page as a view of its own (`atlas-sound`, its Sound
 * tab), and the board builds that view of Atlas's and shows it over the board in the frame of Atlas's DM screen. What
 * plays stays with Atlas's one sound director, so closing the page stops nothing, and Atlas's DM screen or Sound tab
 * beside it show the same desk.
 */
import type { App, ItemView, WorkspaceLeaf } from 'obsidian';

/** The view type Atlas (0.17 and later) registers its Sound page under. */
export const ATLAS_SOUND_VIEW = 'atlas-sound';

type ViewCreator = (leaf: WorkspaceLeaf) => ItemView;
interface ViewRegistry { getViewCreatorByType?(type: string): ViewCreator | undefined; viewByType?: Record<string, ViewCreator | undefined> }

/** Atlas's maker of its Sound page; null when no Atlas with one is running. */
export function soundViewCreator(app: App): ViewCreator | null {
  const registry = (app as unknown as { viewRegistry?: ViewRegistry }).viewRegistry;
  return registry?.getViewCreatorByType?.(ATLAS_SOUND_VIEW) ?? registry?.viewByType?.[ATLAS_SOUND_VIEW] ?? null;
}

/**
 * What Atlas's view is built on in place of a workspace leaf: the page lives in the board's tab, never in a leaf of its
 * own, so the leaf answers only what a view asks of it as it is made (its app and its history for the back buttons).
 */
function standInLeaf(app: App, doc: Document): WorkspaceLeaf {
  return {
    app, view: null, containerEl: doc.createElement('div'), tabHeaderEl: doc.createElement('div'),
    history: { backHistory: [], forwardHistory: [] }, working: false, pinned: false,
    getRoot: () => app.workspace.rootSplit, getContainer: () => app.workspace.rootSplit,
    setViewState: async () => {}, getViewState: () => ({ type: ATLAS_SOUND_VIEW }), detach: () => {}, setPinned: () => {},
    on: () => ({}), off: () => {}, trigger: () => {}, onResize: () => {},
  } as unknown as WorkspaceLeaf;
}

interface Shown { view: ItemView; el: HTMLElement; stopKeys: () => void }

export class SoundWindow {
  private shown: Shown | null = null;
  private opening = false;

  constructor(private readonly container: HTMLElement, private readonly app: App, private readonly onChange?: () => void) {}

  /** Whether a running Atlas has a Sound page the board can show. */
  available(): boolean {
    return soundViewCreator(this.app) !== null;
  }

  isOpen(): boolean {
    return this.shown !== null;
  }

  /** Shows Atlas's Sound page over the board; false when there is no Atlas Sound page to show. */
  async open(): Promise<boolean> {
    if (this.shown || this.opening) return true;
    const creator = soundViewCreator(this.app);
    if (!creator) return false;
    this.opening = true;
    const doc = this.container.ownerDocument;
    // Atlas's DM screen, as Atlas draws it with only its Sound page: a blurred backdrop over the board and the page on it.
    const el = doc.createElement('div');
    el.className = 'atlas-vtt-plugin atlas-tabletop-atlas-ui atlas-tabletop-sound';
    const wrapper = el.createDiv({ cls: 'atlas-dm-screen-wrapper', attr: { tabindex: '-1' } });
    const backdrop = wrapper.createDiv({ cls: 'atlas-dm-screen-backdrop' });
    const screen = wrapper.createDiv({ cls: 'atlas-dm-screen atlas-dm-screen--pages is-visible' });
    const stage = screen.createDiv({ cls: 'atlas-dm-screen-stage' });
    const page = stage.createDiv({ cls: 'atlas-dm-sound-page atlas-dm-page', attr: { 'data-page': 'current' } });
    let view: ItemView;
    try {
      view = creator(standInLeaf(this.app, doc));
      // Only the page itself: the view's header (its tab's back buttons and title) has no place on the board.
      page.appendChild(view.contentEl);
      this.container.appendChild(el);
      await (view as unknown as { onOpen(): Promise<void> }).onOpen();
    } catch (error) {
      console.error('[Tabletop] Atlas\'s Sound page could not be shown on the board:', error);
      el.remove();
      this.opening = false;
      return false;
    }
    backdrop.addEventListener('click', () => this.close());
    // Escape closes it, as it closes Atlas's DM screen, unless a field or one of the page's own menus has it.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .modal-container, [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    el.addEventListener('keydown', onKey);
    this.shown = { view, el, stopKeys: () => el.removeEventListener('keydown', onKey) };
    this.opening = false;
    wrapper.focus({ preventScroll: true });
    this.onChange?.();
    return true;
  }

  close(): void {
    const shown = this.shown;
    if (!shown) return;
    this.shown = null;
    shown.stopKeys();
    // Atlas's view lets go of its page; the music goes on with Atlas's director.
    void Promise.resolve((shown.view as unknown as { onClose(): Promise<void> }).onClose()).catch((error) => console.error('[Tabletop] Atlas\'s Sound page did not close cleanly:', error)).finally(() => shown.el.remove());
    this.onChange?.();
  }

  dispose(): void {
    this.close();
  }
}
