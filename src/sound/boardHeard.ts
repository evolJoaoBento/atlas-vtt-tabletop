/**
 * Whether what a board draws is heard: the board is in front of the GM (on screen, its window shown), or the local
 * players' window it drives is open and in view (the table hears the GM's machine). A board nobody sees is silent.
 */
export function boardHeard(board: { onScreen: boolean; hidden: boolean }, players: { hidden: boolean } | null): boolean {
  return (board.onScreen && !board.hidden) || (players !== null && !players.hidden);
}
