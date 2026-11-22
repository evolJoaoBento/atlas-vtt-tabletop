# Tabletop backlog

Ideas and asks not yet planned, one task per item, **in priority order** (top first; set 2026-11-22). Done items leave
this list (their commits say what was done).

Shortcut tasks: each needs the board feature first; then add its id to `ON_BOARD` and an action in
`src/board/boardHotkeys.ts` so the shortcut help lists it. 2D-only tool tasks: on the 3D board their keys (with Shift,
since the camera keeps W/A/S/D/Q/E) do nothing for now; for each, decide what it does on the board (a board stand-in, or
opening Atlas's 2D map with the tool chosen).

1. **Turn banners** (Atlas 0.18's banner at the start of a turn).
2. **Saved rolls** in the board's dice tray (Atlas 0.18).
3. **The collection's editable dice row** in the board's dice tray (Atlas 0.18).
4. **Compact and horizontal initiative layouts** (Atlas 0.18's tracker layouts).
5. **"Forget explored areas"** (Atlas 0.18).
6. **Connect: tokenless combatants in the Obsidian player scene tab** (the web page shows them; the tab leaves them out).
7. **Fog tool on a map of unknown size** (fog review M4): on a map whose image size is unknown the fog tool cannot paint
    and swallows the press with no notice (Atlas needs no map rect to draw).
8. **Snap reach on a low camera** (fog review M3): the snap and closing reach and the marks' constant width use the metre
    across the view (`unitsPerPixel`), not a pixel's footprint along the ground, so on a low camera the 10 px reach is
    about 5 px deep.
9. **Pin tool** (P; Atlas 2D-only tool).
10. **Text tool** (T; Atlas 2D-only tool).
11. **Draw tool** (B; Atlas 2D-only tool).
12. **Erase tool** (E; Atlas 2D-only tool).
13. **Walls tool** (W; Atlas 2D-only tool).
14. **Soundboard** (`S` in Atlas 0.18; left off the board since Shift+S is Silence there).
15. **Sound tool** (S; Atlas 2D-only tool).
16. **Widget keys** (1–5, + / −, and Space / R while a widget is held; 2026-11-20, user).
17. **"Only show toolbar on hover" setting** (Atlas 0.18).
18. **Five new languages** (de, fr, es, pt, it) for the ported panels (Atlas 0.18; needs a port re-sync from
    `2075-code/atlas-vtt-0.18-ref`).
19. **Measure: Shift flips Keep on release, and the quick ruler from the other tools** (Atlas 0.18: Shift at the end of a measurement keeps it
    if Keep is off and lets it fade if on, a held M ruler included; the board has no Shift flip, and the held M ruler is left out
    of Edit mode, the fog tool, laser and a token's eyes, where the key stays a tap).
