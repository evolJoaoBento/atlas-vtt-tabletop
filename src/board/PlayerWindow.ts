/**
 * The local player view: a window (an Obsidian pop-out, meant for a screen the players look at) that shows a map's 3D
 * board as players see it. It draws nothing itself: the GM's board for the same map draws into it (`Board.attach-
 * Player`), so drags, glides and minis' clips show there as they happen. Until that board is open in the main window
 * it says so and waits; it reopens with Obsidian, and finds the board again when it loads.
 */
import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';

export const PLAYER_VIEW_TYPE = 'atlas-tabletop-player';

/** What the player view asks of the plugin: a board to draw into it, and to stop. */
export interface PlayerServices {
  attach(view: PlayerView): void;
  detach(view: PlayerView): void;
}

const mapName = (path: string): string => path.split('/').pop()!.replace(/\.atlasmap$/, '');

export class PlayerView extends ItemView {
  private path: string | null = null;
  private message: HTMLElement | null = null;
  /** Where the board draws. */
  readonly stage: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly services: PlayerServices) {
    super(leaf);
    this.stage = this.contentEl.createDiv({ cls: 'atlas-tabletop-player-stage' });
  }

  getViewType(): string { return PLAYER_VIEW_TYPE; }
  getIcon(): string { return 'presentation'; }
  getDisplayText(): string {
    return this.path ? `Players: ${mapName(this.path)}` : 'Player view';
  }

  get mapPath(): string | null {
    return this.path;
  }

  getState(): Record<string, unknown> {
    return { file: this.path };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const file = (state as { file?: unknown } | null)?.file;
    if (typeof file === 'string' && file !== this.path) {
      if (this.path) this.services.detach(this);
      this.path = file;
      (this.leaf as unknown as { updateHeader?(): void }).updateHeader?.();
      this.waiting(true);
      this.services.attach(this);
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('atlas-tabletop-player-view');
    // In its own window, the window is the players' screen: no tabs or title bar (styles.css).
    if (this.contentEl.ownerDocument !== document) this.contentEl.ownerDocument.body.addClass('atlas-tabletop-player-window');
    this.waiting(this.path === null || this.message !== null);
  }

  async onClose(): Promise<void> {
    this.services.detach(this);
    this.contentEl.ownerDocument.body.removeClass('atlas-tabletop-player-window');
  }

  /** Says the view waits for the GM's board of its map; false once a board draws into it. */
  waiting(waiting: boolean): void {
    this.message?.remove();
    this.message = null;
    if (!waiting) return;
    const text = this.path
      ? `Waiting for the 3D board of ${mapName(this.path)}. Open the map in 3D in the main window.`
      : 'Open a map in 3D and press its player view button.';
    this.message = this.contentEl.createDiv({ cls: 'atlas-tabletop-player-waiting', text });
  }
}
