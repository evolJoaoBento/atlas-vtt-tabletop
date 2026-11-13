// Atlas source: src/app/ui/confirmDialog.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { createDialogShell } from './dialogShell';
import { t } from '../../shims/i18n';

export interface ConfirmDialogOptions {
  title: string;
  /** One paragraph per entry. */
  message: string[];
  confirmLabel: string;
  /** Styles the confirm button as a warning, for deletions and overwrites. */
  destructive?: boolean;
}

export interface DialogChoice<T> {
  label: string;
  value: T;
  /** `cta` marks the recommended choice, `warning` one that deletes or overwrites. */
  style?: 'cta' | 'warning';
}

export interface ChoiceDialogOptions<T> {
  title: string;
  /** One paragraph per entry. */
  message: string[];
  /** The buttons after Cancel, in order; the last one has focus. */
  choices: DialogChoice<T>[];
}

/**
 * Small centred dialog offering `choices` and Cancel. Resolves the chosen
 * value, or null when cancelled, dismissed via the backdrop or closed with Escape.
 */
export function chooseAction<T>(options: ChoiceDialogOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const close = (value: T | null): void => {
      root.remove();
      resolve(value);
    };
    // Atlas 0.14: a header row with a close button, the paragraphs in the body, the buttons in the footer.
    const { root, dialog, footer } = createDialogShell(options.title, { onDismiss: () => close(null) });
    dialog.parentElement?.addClass('atlas-text-dialog--confirm');
    for (const paragraph of options.message) {
      dialog.createEl('p', { cls: 'atlas-text-dialog__message', text: paragraph });
    }

    const cancel = footer.createEl('button', { text: t('common.cancel') });
    cancel.addEventListener('click', () => close(null));
    const buttons = options.choices.map((choice) => {
      const button = footer.createEl('button', { text: choice.label });
      if (choice.style) button.addClass(`mod-${choice.style}`);
      button.addEventListener('click', () => close(choice.value));
      return button;
    });

    root.addEventListener('click', (event) => {
      if (event.target === root) close(null);
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    });

    (options.choices.some((choice) => choice.style === 'warning') ? cancel : buttons[buttons.length - 1])?.focus();
  });
}

/**
 * Small centred yes/no dialog. Resolves `true` when confirmed and `false` when
 * cancelled, dismissed via the backdrop or closed with Escape.
 */
export async function confirmAction(options: ConfirmDialogOptions): Promise<boolean> {
  const confirmed = await chooseAction({
    title: options.title,
    message: options.message,
    choices: [{ label: options.confirmLabel, value: true, style: options.destructive ? 'warning' : 'cta' }],
  });
  return confirmed === true;
}
