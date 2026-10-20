# Atlas VTT Extension - Tabletop

Opens Atlas VTT maps on a 3D board in Obsidian. The map image becomes a table, and tokens and note pins stand above
where they are on the map. Tokens can carry 3D minis (GLB) and props can be placed on the board. Players joined
through Atlas VTT Connect see the minis too, if they have Tabletop installed.

## Use

- **Open a map in 3D:** right-click an `.atlasmap` file and choose **Open in 3D**, or run **Tabletop: Open map in 3D**
  (it uses the open map file, or the map open in Atlas).
- **Camera** (as in TacticalEngine):
  - left- or middle-drag on the board orbits
  - right-drag pans
  - the wheel zooms
  - WASD or the arrow keys pan, and Q / E turn
  - Home frames the whole map
- **Tokens:**
  - Drag a token to move it. It snaps to the grid like in Atlas and is saved to the map. When Atlas has the same map
    open, the move goes through Atlas.
  - Right-click a token to assign a mini, or to show it as a disc or a standee.
- **Initiative:** Atlas's initiative tracker stands at the board's right edge. **I** shows or hides it (or the board
  settings, ⌘). Add tokens from their right-click menu. While a fight runs, the up and down arrows pass the turn
  instead of moving the camera. When Atlas has the map open, the tracker is Atlas's own, changed through Atlas.
- **Walls and doors:** Atlas's walls stand on the board as tall as the fog (a low wall half that). Click a door to
  open or shut it; it swings on its hinge and is saved through Atlas (or the map file). Right-click a door to lock it,
  or to replace it with a prop from the gallery, which is fitted to the opening and swings the same way. A secret door
  looks like the walls around it; the GM sees a thin line on it, and on a one-way wall an arrow the way light passes,
  which players do not. Walls and doors under the fog of war are hidden from players.
- **Materials:** the gallery's **Materials** tab imports texture sets as Poly Haven gives them (the zip, its maps, or a
  folder of them), kept in `atlas-vtt/assets/materials`. Drag one onto a wall or door to paint that segment; hold
  **Shift** to paint the whole wall (the segments drawn in one stroke, or else those joined end to end up to a
  junction or a door). Right-click a wall to take its material off.
- **Lights:** Atlas's lights (placed, and carried by tokens) shine on the board with their colour, bright and dim
  radii, and flicker (in the dark). The board settings (⌘) have an ambient light slider: lower it and the map goes
  dark; it starts at Atlas's ambient light when the map has Atlas's lighting on. Right-click a light's bulb, or a
  token carrying one, to set how high it hangs. The lights nearest where the camera rests cast shadows (none on Low
  quality, 2 on Medium, 4 on High).
- **Notes:** click a pin to open its note in a new tab.
- **Props:** open the gallery (**Open minis gallery**) and go to the **Props** tab. Click a prop, then click the board
  where it should go. **Ctrl + drag** moves a prop, and right-clicking one removes it.
- **Folders:** minis live in `atlas-vtt/assets/minis` and props in `atlas-vtt/assets/props`. Both can be changed in
  the settings.

GLBs must be self-contained and uncompressed (no Draco or Meshopt).

## Build and test

```
npm install
npm run build        # type-check and bundle main.js
npm test             # unit tests (node:test)
node scripts/deploy.mjs   # copy into a vault's plugin folder (ATLAS_VAULT=<vault>, default ..)
```

Browser harness for the 3D board:

```
npx esbuild harness/board.ts --bundle --outfile=<dir>/board.js --alias:obsidian=./harness/obsidian-stub.ts
cp harness/board.html <dir>/index.html && cp styles.css <dir>/
node harness/board-test.cjs <dir> <screenshot dir>
```

## Credits

The pin and condition icons, and the End combat flag, are from [game-icons.net](https://game-icons.net) (CC BY 3.0), by Lorc, Delapouite and contributors.
They are the same icons Atlas VTT uses, and pins show the same colours as in Atlas.
