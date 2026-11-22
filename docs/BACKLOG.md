# Tabletop backlog

Ideas and asks not yet planned, one task per item. Newest first. Done items leave this list (their commits say what was
done).

## Fog tool leftovers (2026-11-21)

- **Fog menu under Select/Move**: Atlas also opens the fog menu (Reveal, Hide, Delete) on a right-click on fog while its
  Select or Move tool is on; the board offers it only with the fog tool on. (Atlas 0.18's menu rows have no icons, its
  item renderer ignores `icon`, so neither has the board's.)
- **Snap reach on a low camera** (review M3): the snap and closing reach and the marks' constant width use the metre
  across the view (`unitsPerPixel`), not a pixel's footprint along the ground, so on a low camera the 10 px reach is
  about 5 px deep.
- **Fog tool on a map of unknown size** (review M4): on a map whose image size is unknown the fog tool cannot paint and
  swallows the press with no notice (Atlas needs no map rect to draw).

## Atlas 0.18 features the board does not show yet (2026-11-21, survey of 0.18.0)

- **Saved rolls** in the board's dice tray.
- **The collection's editable dice row** in the board's dice tray.
- **Compact and horizontal initiative layouts** (Atlas's tracker layouts).
- **Turn banners** (Atlas's banner at the start of a turn).
- **Soundboard** (`S`; left off the board since Shift+S is Silence there).
- **"Forget explored areas"**.
- **Hold M and drag to measure**.
- **"Only show toolbar on hover" setting**.
- **Five new languages** (de, fr, es, pt, it) for the ported panels (needs a port re-sync from
  `2075-code/atlas-vtt-0.18-ref`).
- **Connect: tokenless combatants in the Obsidian player scene tab** (the web page shows them; the tab leaves them out).

## Atlas shortcuts the board has no feature for yet (2026-11-20, user)

Each needs the board feature first; then add its id to `ON_BOARD` and an action in `src/board/boardHotkeys.ts` so the
shortcut help lists it.

- **Lighting peek** (H, and Atlas's peek button for touch).
- **Copy / cut / paste tokens** (Ctrl/Cmd + C / X / V).
- **Duplicate tokens** (Ctrl/Cmd + D).
- **Widget keys** (1–5, + / −, and Space / R while a widget is held).

## Atlas's 2D-only tools on the board (2026-11-20, user)

Atlas's tools below exist only on its 2D map; on the 3D board their keys (with Shift, since the camera keeps
W/A/S/D/Q/E) do nothing for now. For each, decide what it does on the board (a board stand-in, or opening Atlas's 2D map
with the tool chosen).

- **Draw** (B).
- **Erase** (E).
- **Text** (T).
- **Pin** (P).
- **Walls** (W).
- **Sound** (S).
