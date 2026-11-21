# Fog tool on the 3D board — design

2026-11-21. Asked by the user: "make the fog tool like the fog tool in Atlas including the toolbar it pops with and
everything in there. For painting be inspired by how the liquid painter works."

## Intent

The GM paints and erases Atlas's fog of war from the 3D board exactly as in Atlas 0.18: same button, same bars above
the toolbar, same shapes, actions, menu, keys and results. The fog is Atlas's (`state.objects.fog`), written through
Atlas's own store actions, so Atlas, players and every other view see the same fog and Atlas's undo covers it.
Atlas is the source of truth: copy its texts, numbers, order and behaviour (Atlas 0.18 source:
`C:\Users\joaoo\2075-code\atlas-vtt-0.18-ref`, mainly `src/app/packages/components/toolbar/FogToolBar.tsx`,
`fogToolChoices.ts`, `src/app/pixi/fog/*`, `src/app/fog/*`, `src/app/stores/fogSlice.ts`, `types/fogTypes.ts`,
`i18n/locales/en/fog.ts`).

## User decisions

- The fog tool is in **Edit mode only** (beside the liquid painter); not in Play or Cinematic.
- **Alt flips paint/erase**, as Atlas (live, mid-stroke too). Shift keeps Atlas's meanings (square rectangle, 45° polygon
  edges). **The liquid painter changes from Shift to Alt too** (its erase-while-held key), and its help row follows.
- Painting is inspired by the liquid painter: a brush ring on the ground that follows the pointer, the stroke seen as it
  is drawn, Ctrl+scroll also resizes the brush.

## What Atlas 0.18 has (to match)

Main toolbar: one **Fog Tool** button (lucide Cloud; "Fog Eraser" while the eraser mode is on), no chevron. Hotkey
`fog` (default F) opens it; pressed again it toggles Fog ↔ Eraser. On the board F is free outside the first-person eyes
view (there F stays "cast a spell"); Atlas's F binding is used as is (it is not a camera letter, so no Shift).

Bars above the toolbar while the tool is on (`atlas-tool-bars`, GM only):
1. `Fog` bar (`atlas-tool-bar--modes`): **Fog** (Cloud, tip "Hold Alt to erase instead. Right-click fog to reveal or
   delete it") and **Eraser** (Eraser, tip "Hold Alt to add fog instead").
2. `Fog shapes and actions` bar (`atlas-tool-bar--tools`): shapes **Brush** (Paintbrush), **Rectangle** (Square,
   "Hold Shift for a square"), **Polygon** (Pentagon, "Click corners. Enter closes it"), **Lasso** (Lasso), **Cells**
   (Grid3x3, "Drag over cells of the grid"; disabled "This map has no grid"), **Room** (DoorOpen, "Click inside walls to
   fill the room"; disabled "This map has no walls" / "This level has no walls"); an unavailable chosen shape falls back
   to Brush. Then the **brush size** button (dot 4–16 px wide; disabled unless Brush: "Only the brush has a size";
   shortcut `, .`) opening a "Brush size" slider 10–200 map px radius, default 50, shown in cells
   `round(20*r/grid)/10` "{n} cell(s)". Break. **Cover all** (PaintBucket; "Hides the whole map" / "Hides this whole
   level"; notice "This scene has no map to cover." if it fails). **Delete all fog** (CloudOff; "Removes all fog from this
   map/level"; disabled "No fog on this map/level"); no confirmation. Break. **More** (MoreHorizontal) menu: slider
   "Fog opacity in GM view" 10–100 % step 5 default 50 (Atlas setting `getGmFogOpacity`/`setGmFogOpacity`, per device;
   the board's GM fog uses it too); switches **Snap** and **Constrain** (0.18 tool switches `fogSnap`, `fogConstrain`: Ctrl/Cmd
   and Shift turn them around while held); item **Hide all rooms** (LayoutGrid; disabled without walls; notices
   "{n} room(s) hidden", "Every room is hidden already", "No rooms found").

Interaction: primary button only. Brush: press-drag collects points + radius; ring cursor (dark 4 px α .55 under light
1.5 px α .95, white painting / #ff4444 erasing, constant on screen); `,`/`.` resize ×/÷1.15 (held key 1.05), rounded,
clamped 10–200, at least 1 px. Rectangle: drag, first corner snapped, Shift square. Lasso: free drag, closed on release
(fewer than 3 points: nothing). Polygon: click corners; Enter, a click on the first corner or a double click closes;
Backspace (or the undo key) drops the last corner; Escape or blur drops it; Shift 45° edges; Ctrl/Cmd free. Cells:
drag outlines cells, release fills (square: row runs merged into one lasso; hex: one lasso per hex). Room: hover outlines
the walls' room, a click (within 4 px) fills it; notice "The walls here do not enclose a room." Snapping (rectangle and
polygon points only): within 10 screen px of wall endpoint, then grid point, then wall segment; otherwise nearest grid
point when grid Snap is on; a guide mark shows the snap. Erasing non-brush shapes shows a wash over the area. Outline
colours white / #ff4444. Right-click on fog: menu **Reveal** (eye) and **Delete** (trash, destructive); on revealed open
ground: **Hide** (eye-off) and **Delete**.

Data: Atlas's store actions `addFogOperation(s)`, `clearFog`, `coverAllFog(mapRect)`, `revealFogGround(outlines)`,
`hideFogArea(id)`, `forgetFogArea(id)`, `hideRooms(mapRect, coverage)`; operations `brush {points, brushRadius}`,
`lasso {points, area?}`, `rectangle {x,y,width,height, area?}`, `isErasing`; all act on the store's viewed level. Polygon,
cells and room commit as lasso.

## Constraints

- Tabletop supports Atlas 0.15+: every Atlas action/setting used is feature-checked; what an older Atlas lacks is
  disabled with Atlas's reason or left out, never a crash.
- Writes go through `TokenWriter` (Atlas holds the map; same `ready`/`NotHeldError` path as liquids) and are recorded in
  Tabletop's undo via `recordAtlasWrites` (`undoRecorders.ts` WRITES/WRITE_LABELS).
- The level written is the level the board shows (as liquids do).
- Pure Atlas logic (rooms, cells, snapping, polygon, coverage, fog body) is copied from Atlas, not rewritten, under
  `src/atlasPort` following `docs/atlas-parity.md` and `scripts/atlasPortList.mjs`.
- Tests: unit tests for pure logic and the writer; UI harness features (`harness/features-test.cjs`) for the bars,
  each shape, keys, Alt flip, menu, disabled states and the liquid painter's Alt.

## Left to the builder

3D drawing details (ring, outlines and wash as flat meshes on the ground like the liquid brush ring); how live preview
of a brush stroke is drawn before commit (a flat translucent ribbon is fine); module split.
