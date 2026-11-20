/**
 * Atlas's shortcut help on the 3D board (its `help` key, `?`): Atlas's own component (copied, src/atlasPort/app), listing
 * only the shortcuts the board has, with the keys the board takes (`boardHotkeys.ts`), and the board's own keys after them.
 */
import '../atlasPort/installHost';
import type { App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { HotkeyHelp } from '../atlasPort/app/keyboard/HotkeyHelp';
import { AtlasUIContext } from '../atlasPort/shims/atlasUI';
import type { BoardHotkeyHelp } from '../atlasPort/shims/boardHotkeyHelp';
import { boardBinding, BOARD_OWN_KEYS, worksOnBoard } from './boardHotkeys';

/** What the board adds to Atlas's help: its filter, its keys, and its own sections in Atlas's markup. */
export const BOARD_HELP: BoardHotkeyHelp = {
  shows: (id) => worksOnBoard(id),
  binding: (_id, key) => boardBinding(key) ?? key,
  sections: BOARD_OWN_KEYS.map((group) => (
    <section key={group.heading} data-tabletop-keys="">
      <h3>{group.heading}</h3>
      <dl>
        {group.keys.map((entry) => (
          <div key={entry.does}>
            <dt>{entry.does}</dt>
            <dd><kbd>{entry.keys}</kbd>{entry.when ? ` ${entry.when}` : ''}</dd>
          </div>
        ))}
      </dl>
    </section>
  )),
};

export class HotkeyHelpWindow {
  private readonly root: Root;
  private readonly el: HTMLElement;
  private open_ = false;

  /** Atlas's key bindings come through `app` (the copies' settings stand-in reads Atlas's own; its defaults without Atlas). */
  constructor(host: HTMLElement, private readonly app: App) {
    this.el = host.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-atlas-ui';
    host.appendChild(this.el);
    this.root = createRoot(this.el);
  }

  isOpen(): boolean {
    return this.open_;
  }

  toggle(): void {
    this.open_ = !this.open_;
    this.render();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.render();
  }

  dispose(): void {
    this.root.unmount();
    this.el.remove();
  }

  private render(): void {
    if (!this.open_) { this.root.render(null); return; }
    this.root.render(
      <AtlasUIContext.Provider value={{ app: this.app, view: null as never, pixiApp: null, renderer: null }}>
        <HotkeyHelp onClose={() => this.close()} board={BOARD_HELP} />
      </AtlasUIContext.Provider>,
    );
  }
}
