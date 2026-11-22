# Tabletop backlog

Ideas and asks not yet planned, one task per item, **in priority order** (top first; set 2026-11-22). Done items leave
this list (their commits say what was done).

Shortcut tasks: each needs the board feature first; then add its id to `ON_BOARD` and an action in
`src/board/boardHotkeys.ts` so the shortcut help lists it. 2D-only tool tasks: on the 3D board their keys (with Shift,
since the camera keeps W/A/S/D/Q/E) do nothing for now; for each, decide what it does on the board (a board stand-in, or
opening Atlas's 2D map with the tool chosen).

1. **Saved rolls, the rest** (Atlas 0.18; the saved rolls panel and the tray's editable dice row are done: save, throw, rename, delete, pin, shared with Atlas):
    the dice editor of a designed roll (each die's faces, name and colour, critical, exploding and advantage rules), the flask that
    keeps a Dice Lab set as a saved roll, and the saved rolls' tour. A saved roll in the row throws at once on the board (Atlas adds a formula roll to the tray's formula; the board's tray holds dice, not a formula). The board's own
    formula grammar has no written `adv` / `dis` and no `*`, `/` or brackets, so a saved roll using them says why it cannot be thrown.
2. **Connect: tokenless combatants in the Obsidian player scene tab** (the web page shows them; the tab leaves them out).
3. **Fog tool on a map of unknown size** (fog review M4): on a map whose image size is unknown the fog tool cannot paint
    and swallows the press with no notice (Atlas needs no map rect to draw).
4. **Snap reach on a low camera** (fog review M3): the snap and closing reach and the marks' constant width use the metre
    across the view (`unitsPerPixel`), not a pixel's footprint along the ground, so on a low camera the 10 px reach is
    about 5 px deep.
5. **Pin tool** (P; Atlas 2D-only tool).
6. **Text tool** (T; Atlas 2D-only tool).
7. **Draw tool** (B; Atlas 2D-only tool).
8. **Erase tool** (E; Atlas 2D-only tool).
9. **Walls tool** (W; Atlas 2D-only tool).
10. **Soundboard** (`S` in Atlas 0.18; left off the board since Shift+S is Silence there).
11. **Sound tool** (S; Atlas 2D-only tool).
12. **Widget keys** (1–5, + / −, and Space / R while a widget is held; 2026-11-20, user).
13. **"Only show toolbar on hover" setting** (Atlas 0.18).
14. **Five new languages** (de, fr, es, pt, it) for the ported panels (Atlas 0.18; needs a port re-sync from
    `2075-code/atlas-vtt-0.18-ref`).
15. **Measure: Shift flips Keep on release** (Atlas 0.18: Shift at the end of a measurement keeps it if Keep is off and lets it
    fade if on, a held M ruler included; the board's measure tool has no Shift flip).
16. **Turn banner, the rest** (Atlas 0.18; the GM's banner over the board is done): the players' banner in Tabletop's player window
    (Atlas's `TurnBannerStage`, viewer `players`: hidden combatants are not announced, names follow the player view's setting), the
    camera following the turn (Atlas's `followTurn`). Connect's player page has no turn banner either. (The "Turn banner" switch is done:
    the board's tracker options menu writes Atlas's own setting.)
17. **Tracker options menu, the rest** (Atlas 0.18; the Compact view, Turn banner, Reset and Clear rows are done, and the board's tracker is
    the compact list when Atlas's setting says so): the menu's party row (add the players at the table, or open the collection's party)
    and Add enemy (a combatant without a token), Clear's confirmation dialog, and Atlas's floating header and number-editing in the
    cards. Atlas 0.18 has no horizontal layout for the GM's tracker (always the right edge; only the players' list can run as a row
    across the top or bottom, mirrored for the far side of the table, in What players see): there is no players' list in Tabletop's
    player window yet to give it.
18. **Explored areas on the board** (Atlas 0.18; "Forget explored areas" is in the lighting menu and writes Atlas's own request, but the board does not draw the players' explored memory at all, so nothing shows the forgetting; the memory lives in Atlas's lighting texture and the saved mask `exploredMask(s)`).
