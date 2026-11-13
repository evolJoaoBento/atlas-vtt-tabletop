// Stand-in for Atlas's ui/dialogShell.ts (createTextDialogShell) at 0.14.0, hand-ported from its main.js: Atlas 0.14's
// text dialog is a header row (the title as an h3, an optional icon, a close button when it can be dismissed), a body
// and a footer for the buttons, styled by `.atlas-text-dialog__header` / `__body` / `__footer` in Atlas 0.14's styles.css.
import { setIcon } from 'obsidian';
import { t } from './i18n';

export interface DialogShellOptions {
  /** A Lucide icon id, shown before the title. */
  icon?: string;
  /** Adds the close button to the header; called when it is pressed. */
  onDismiss?: () => void;
}

export interface DialogShell {
  /** Backdrop covering the window; removing it closes the dialog. */
  root: HTMLElement;
  /** The dialog's body: where its content goes. */
  dialog: HTMLElement;
  /** The row of buttons under the body. */
  footer: HTMLElement;
}

let titles = 0;

/**
 * Mounts a centred, titled dialog on `document.body`. It stacks above Atlas
 * overlays such as the asset manager, which Obsidian's own modals do not.
 */
export function createDialogShell(title: string, options: DialogShellOptions = {}): DialogShell {
  const root = document.body.createDiv({ cls: 'atlas-vtt-plugin atlas-text-dialog-backdrop' });
  const frame = root.createDiv({ cls: 'atlas-text-dialog', attr: { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' } });
  const header = frame.createDiv({ cls: 'atlas-text-dialog__header' });
  const heading = header.createEl('h3', { cls: 'atlas-text-dialog__title' });
  if (options.icon) setIcon(heading.createSpan({ cls: 'atlas-text-dialog__icon', attr: { 'aria-hidden': 'true' } }), options.icon);
  heading.createSpan({ text: title });
  const id = `atlas-text-dialog-title-${++titles}`;
  heading.id = id;
  frame.setAttribute('aria-labelledby', id);
  const { onDismiss } = options;
  if (onDismiss) {
    const close = header.createEl('button', { cls: 'atlas-close-btn btn btn--ghost btn--icon', attr: { type: 'button', 'aria-label': t('common.close') } });
    setIcon(close, 'x');
    close.addEventListener('click', () => onDismiss());
  }
  const body = frame.createDiv({ cls: 'atlas-text-dialog__body' });
  const footer = frame.createDiv({ cls: 'atlas-text-dialog__footer' });
  return { root, dialog: body, footer };
}
