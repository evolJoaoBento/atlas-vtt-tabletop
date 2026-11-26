/**
 * The keys Atlas's widget bar takes on the board (widgetBar.tsx): while a widget's number is held (1 to 5), its keys
 * (+, =, -, Space, R by Atlas's bindings) step it, and the number itself picks it. In Atlas the bar hears them before
 * the map's shortcuts; on the board the board's own key handlers ask `widgetTakes` first and leave such a key alone
 * (Space would otherwise open the command palette, R turn a token). Plain module state, no React: the board reads it.
 */
const taken = new WeakSet<Event>();

/** Marks a key the widget bar takes. */
export function giveToWidgets(event: Event): void {
  taken.add(event);
}

/** Whether the widget bar takes this key: the board's handlers then do nothing with it. */
export function widgetTakes(event: Event): boolean {
  return taken.has(event);
}
