# Tabletop backlog

Ideas and asks not yet planned. Newest first. Done items leave this list (their commits say what was done).

- **Atlas shortcuts the board has no feature for yet** (2026-11-20, user): Atlas's GM view (D, Shift+D on the board),
  lighting peek (H), copy / cut / paste / duplicate tokens (Ctrl/Cmd + C / X / V / D) and the widget keys (1–5, + / −,
  and Space / R while a widget is held). Each needs the board feature first; then add its id to `ON_BOARD` and an
  action in `src/board/boardHotkeys.ts` so the shortcut help lists it.
- **Atlas's 2D-only tool keys on the board** (2026-11-20, user): Atlas's fog (F), draw (B), erase (E), text (T),
  pin (P), walls (W) and sound (S) tools exist only on its 2D map. On the 3D board their keys (with Shift, since the
  camera keeps W/A/S/D/Q/E) do nothing for now. Decide later what each should do on the board (a board stand-in, or
  opening Atlas's 2D map with the tool chosen).
