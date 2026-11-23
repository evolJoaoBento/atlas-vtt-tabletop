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
    formula grammar has no `*`, `/` or brackets, so a saved roll using them says why it cannot be thrown (a written `adv` / `dis` is read since Atlas 0.19).
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
15. **Turn banner, the rest** (Atlas 0.18; the GM's banner over the board is done): the players' banner in Tabletop's player window
    (Atlas's `TurnBannerStage`, viewer `players`: hidden combatants are not announced, names follow the player view's setting), the
    camera following the turn (Atlas's `followTurn`). Connect's player page has no turn banner either. (The "Turn banner" switch is done:
    the board's tracker options menu writes Atlas's own setting.)
16. **Tracker options menu, the rest** (Atlas 0.18; the Compact view, Turn banner, Reset and Clear rows are done, and the board's tracker is
    the compact list when Atlas's setting says so): the menu's party row (add the players at the table, or open the collection's party)
    and Add enemy (a combatant without a token), Clear's confirmation dialog, and Atlas's floating header and number-editing in the
    cards. Atlas 0.18 has no horizontal layout for the GM's tracker (always the right edge; only the players' list can run as a row
    across the top or bottom, mirrored for the far side of the table, in What players see): there is no players' list in Tabletop's
    player window yet to give it.
17. **Explored areas on the board** (Atlas 0.18; "Forget explored areas" is in the lighting menu and writes Atlas's own request, but the board does not draw the players' explored memory at all, so nothing shows the forgetting; the memory lives in Atlas's lighting texture and the saved mask `exploredMask(s)`).
18. **Ranges measure mode** (Atlas 0.18's Ranges: click a token or a place to see its range bands or movement steps; Atlas 0.19 no longer asks for GM view and shows the rings to the players, in the player window and online). The board's measure menu lists Ranges but it is never offered (`rangesUnavailable` has no provider); the rings, the range check between two tokens and the players seeing them are all to build. The key (M) cycles to it where offered.
19. **Order the sides before a fight** (Atlas 0.19: drag a side's heading in the tracker to choose who acts first, written as `initiative.sideOrder`). The board's tracker already lists the sides, and starts the fight (Atlas's `startCombat`), in the order Atlas holds; it has no way to change that order. Atlas's `setSideOrder` is the store action.
20. **Smoother initiative drag** (Atlas 0.19: cards are dragged as a phone's home screen is arranged, with `useRowDrag`; the others shiver and slide aside, and a dropped card glides home). The board's tracker still uses the browser's drag and drop with a drop line.
21. **Initiative list scroll shades** (Atlas 0.19: a fade at the bottom of the list while more lies below, shown without a round at the foot; and the compact list shows at most 12 lines before it scrolls). The board's tracker has the top shade only and its compact list is as tall as its combatants.
22. **Players' ranges, measures and rolls online** (Atlas 0.19 Atlas Online: players see the GM's Ranges rings, roll and edit values written with `adv` / `dis`; Connect's player page and Tabletop's player window have neither).
23. **Stream Deck and Atlas's Sound page** (Atlas 0.19: Stream Deck settings, the music packs, downloads list and sorting on the Sound page): Atlas's own pages, nothing on the board, listed so a later look at the board's sounds (Tabletop's own, `src/sound`) can decide whether to offer any of Atlas's.
24. **Kept measurement popover, the rest** (Atlas 0.19; the handles, the popover with colour, effect, Players see it, Stops at walls, line width, Select tokens and Delete, and the drag/resize/turn are done): the light an area gives (the *Gives light* / *Magical darkness* switch with its two ranges and flicker, and the light an effect chip starts: Atlas's `MeasureLook`, `effectChoice`, `measureLights.ts`); *Follows token* on a circle that lies on a token (an aura, `FollowsToken`) and an aura's far handle that changes how far it reaches (`auraArea.ts`, `AuraDragSetting`); a handle lifts at once under the pointer and while dragged (Atlas eases both); the popover is placed beside its badge on the right or the left, not by Atlas's `placeLightPopover` (which also avoids the ring handles); a handle hidden behind a wall or a tall piece at a low camera is still pressable (the handles are drawn over everything, as the board's pins are); cast spells (3D) have no handle, their own erase stays.
25. **Measure effects and walls, the rest** (Atlas 0.19; areas with an effect stand in 3D from the floor and every area and cast stops at walls: done): the measurement still being dragged (the live overlay) is drawn whole, not cut by walls; Connect's player page and board do not draw an area's effect or its wall cut (the marks Connect sends carry neither `effect` nor `walls`, `TemplateMark.effect` / `uncut`); the spell looks that are meshes (a radiance's rays, a lightning bolt, an ice crystal) are fitted to the footprint's bounding slab and are not cut to its outline, only the body and the particles are; an aura (an area that follows a token) is not drawn with its effect; the light an effect gives stays item 24.
