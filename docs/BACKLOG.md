# Tabletop backlog

Ideas and asks not yet planned. Newest first. Done items leave this list (their commits say what was done).

- **Fog menu under the Move/Select tools** (2026-11-21): Atlas also opens the fog menu (Reveal, Hide, Delete) on a right-click
  on fog while its Select or Move tool is on; the board offers it only with the fog tool on. Also left out: Atlas's menu rows
  have no icons in 0.18 (its item renderer ignores `icon`), so neither has the board's.
  Fog tool review leftovers (2026-11-21), left as they are: (M3) the snap and closing reach and the marks' constant width use the
  metre across the view (`unitsPerPixel`), not a pixel's footprint along the ground, so on a low camera the 10 px reach is about 5 px deep;
  (M4) on a map whose image size is unknown the fog tool cannot paint and swallows the press with no notice (Atlas needs no map rect to draw).

- **Atlas 0.18 features the board does not show yet** (2026-11-21, survey of 0.18.0): saved rolls and the collection's
  editable dice row in the board's dice tray; Atlas's compact / horizontal initiative layouts and turn banners; the
  soundboard (`S`, left off the board since Shift+S is Silence there); "Forget explored areas"; hold M and drag to
  measure; the "only show toolbar on hover" setting; the five new languages (de, fr, es, pt, it) for the ported panels
  (needs a port re-sync from `2075-code/atlas-vtt-0.18-ref`). Connect: its Obsidian player scene tab still leaves out
  combatants without a token (the web page shows them).

- **Atlas shortcuts the board has no feature for yet** (2026-11-20, user): Atlas's GM view (D, Shift+D on the board),
  lighting peek (H), copy / cut / paste / duplicate tokens (Ctrl/Cmd + C / X / V / D) and the widget keys (1–5, + / −,
  and Space / R while a widget is held). Each needs the board feature first; then add its id to `ON_BOARD` and an
  action in `src/board/boardHotkeys.ts` so the shortcut help lists it.
- **Atlas's 2D-only tool keys on the board** (2026-11-20, user): Atlas's draw (B), erase (E), text (T),
  pin (P), walls (W) and sound (S) tools exist only on its 2D map (the fog tool, F, is on the board since 2026-11-21). On the 3D board their keys (with Shift, since the
  camera keeps W/A/S/D/Q/E) do nothing for now. Decide later what each should do on the board (a board stand-in, or
  opening Atlas's 2D map with the tool chosen).
