# Tabletop backlog

Ideas and asks not yet planned, one task per item, **in priority order** (top first; set 2026-11-22). Done items leave
this list (their commits say what was done).

Shortcut tasks: each needs the board feature first; then add its id to `ON_BOARD` and an action in
`src/board/boardHotkeys.ts` so the shortcut help lists it. 2D-only tool tasks: on the 3D board their keys (with Shift,
since the camera keeps W/A/S/D/Q/E) do nothing for now; for each, decide what it does on the board (a board stand-in, or
opening Atlas's 2D map with the tool chosen).

1. **Copy / cut / paste tokens** (Ctrl/Cmd + C / X / V; 2026-11-20, user).
2. **Duplicate tokens** (Ctrl/Cmd + D; 2026-11-20, user).
3. **Lighting peek** (H, and Atlas's peek button for touch; 2026-11-20, user).
4. **Hold M and drag to measure** (Atlas 0.18).
5. **Turn banners** (Atlas 0.18's banner at the start of a turn).
6. **Saved rolls** in the board's dice tray (Atlas 0.18).
7. **The collection's editable dice row** in the board's dice tray (Atlas 0.18).
8. **Compact and horizontal initiative layouts** (Atlas 0.18's tracker layouts).
9. **"Forget explored areas"** (Atlas 0.18).
10. **Connect: tokenless combatants in the Obsidian player scene tab** (the web page shows them; the tab leaves them out).
11. **Fog tool on a map of unknown size** (fog review M4): on a map whose image size is unknown the fog tool cannot paint
    and swallows the press with no notice (Atlas needs no map rect to draw).
12. **Snap reach on a low camera** (fog review M3): the snap and closing reach and the marks' constant width use the metre
    across the view (`unitsPerPixel`), not a pixel's footprint along the ground, so on a low camera the 10 px reach is
    about 5 px deep.
13. **Pin tool** (P; Atlas 2D-only tool).
14. **Text tool** (T; Atlas 2D-only tool).
15. **Draw tool** (B; Atlas 2D-only tool).
16. **Erase tool** (E; Atlas 2D-only tool).
17. **Walls tool** (W; Atlas 2D-only tool).
18. **Soundboard** (`S` in Atlas 0.18; left off the board since Shift+S is Silence there).
19. **Sound tool** (S; Atlas 2D-only tool).
20. **Widget keys** (1–5, + / −, and Space / R while a widget is held; 2026-11-20, user).
21. **"Only show toolbar on hover" setting** (Atlas 0.18).
22. **Five new languages** (de, fr, es, pt, it) for the ported panels (Atlas 0.18; needs a port re-sync from
    `2075-code/atlas-vtt-0.18-ref`).
