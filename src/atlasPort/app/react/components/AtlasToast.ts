// Atlas source: src/app/react/components/AtlasToast.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
/** Show a temporary toast notification styled to match Atlas VTT. */
export function showAtlasToast(message: string, duration = 3000): void {
  const container =
    document.querySelector<HTMLElement>('.atlas-toast-container') ??
    document.body.createDiv({ cls: 'atlas-toast-container' });
  const toast = container.createDiv({ cls: 'atlas-toast', text: message });

  // Trigger enter animation
  window.requestAnimationFrame(() => {
    toast.classList.add('atlas-toast-visible');
  });

  // Auto dismiss
  window.setTimeout(() => {
    toast.classList.add('atlas-toast-exiting');
    toast.addEventListener('transitionend', () => {
      toast.remove();
      // Clean up container if empty
      if (container.children.length === 0) {
        container.remove();
      }
    });
  }, duration);
}
