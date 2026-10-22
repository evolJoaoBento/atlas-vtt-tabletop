# Tabletop for Atlas VTT

Tabletop for Atlas VTT is a community extension. It is not made, endorsed or supported by Atlas VTT or Atlas Online.

Opens Atlas VTT maps on a 3D board in Obsidian. The map image becomes a table, and tokens and note pins stand above
where they are on the map. Tokens can carry 3D minis (GLB) and props can be placed on the board. Players joined
through Connect for Atlas VTT see the minis too, if they have Tabletop installed.

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
  which players do not. Walls and doors under the fog of war are hidden from players. Right-click a wall to set its
  own height (or the whole wall's), in quarter squares, or **Ctrl + drag** it up or down (with Shift held when you let
  go, the whole wall); until set it stands as tall as the fog.
- **Materials:** the gallery's **Materials** tab imports texture sets as Poly Haven gives them (the zip, its maps, or a
  folder of them), kept in `atlas-vtt/assets/materials`. Drag one onto a wall or door to paint that segment; hold
  **Shift** to paint the whole wall (the segments drawn in one stroke, or else those joined end to end up to a
  junction or a door). Or click a material, then click walls on the board (Esc stops). Right-click a wall to take its
  material off. Right-click a material in the gallery and choose **Edit material…** to set how many grid squares one
  tile of its texture covers (kept in the material's folder, as `material.json`).
- **Lights:** Atlas's lights (placed, and carried by tokens) shine on the board with their colour, bright and dim
  radii, and flicker (in the dark). The board settings (⌘) have an ambient light slider: lower it and the map goes
  dark; it starts at Atlas's ambient light when the map has Atlas's lighting on. Right-click a light's bulb, or a
  token carrying one, to set how high it hangs, or **Ctrl + drag** a bulb up or down. The lights nearest where the camera rests cast shadows (none on Low
  quality, 2 on Medium, 4 on High).
- **Notes:** click a pin to open its note in a new tab.
- **Props:** open the gallery (**Open minis gallery**) and go to the **Props** tab. Click a prop, then click the board
  where it should go. **Ctrl + drag** moves a prop, and right-clicking one removes it.
- **Folders:** minis live in `atlas-vtt/assets/minis` and props in `atlas-vtt/assets/props`. Both can be changed in
  the settings.
- **Dice:** the **Dice** button on the board's toolbar opens Atlas's dice tray. Pick dice (right-click a die for its
  colours, each with how many of it are in that colour), a modifier and advantage, then **Roll**: the dice are laid
  on the table where the camera looks. Press a die and drag to carry it, and let go to throw it; **Ctrl** and a press
  gathers every die into one throw, and **Throw all** throws the rest. Dice bounce off tokens, props and walls, and
  only the map's edge stops them. Dice still to be thrown carry a line round them. A die caught on an edge gives no
  number and asks to be thrown again; an exploding die asks for another. Once every die has landed, the roll goes to
  Atlas's roll log (and again whenever a die is thrown again). The **Dice log** and **Stat sheet** buttons beside it
  show the rolls on the map and the selected token's sheet, whose rolls are thrown the same way. Dice packs are read
  from `.obsidian/atlas-dice-packs/`, shared with Interactive Dice for Atlas VTT. Players' windows never show the
  GM's dice; with Connect for Atlas VTT, players throw their own on their 3D view.

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
npx esbuild harness/board.ts --bundle --outfile=<dir>/board.js --alias:obsidian=./harness/obsidian-stub.ts --loader:.png=binary
cp harness/board.html <dir>/index.html && cp styles.css <dir>/
# optional, for screenshots in Atlas's look: cp <vault>/.obsidian/plugins/atlas-vtt/styles.css <dir>/atlas.css
node harness/board-test.cjs <dir> <screenshot dir>
```

The harnesses use Playwright's Chromium: install `playwright`, or point `PLAYWRIGHT_MODULE` at an installed copy.

Player board harness (Tabletop's 3D board as Connect for Atlas VTT mounts it in a player's tab):

```
npx esbuild harness/playerBoard.ts --bundle --outfile=<dir>/playerBoard.js --alias:obsidian=./harness/obsidian-stub.ts --loader:.png=binary
sed 's/board\.js/playerBoard.js/' harness/board.html > <dir>/playerBoard.html && cp styles.css <dir>/
node harness/playerBoard-test.cjs <dir> <screenshot dir>
```

## License

[AGPL-3.0](LICENSE), as Connect for Atlas VTT.

## Credits

The dice's shapes, faces and pack format come from [Interactive Dice for Atlas VTT](https://github.com/evolJoaoBento/atlas-physical-dice) (MIT).
3D with [three.js](https://threejs.org) (MIT) and physics with [cannon-es](https://github.com/pmndrs/cannon-es) (MIT).

The pin and condition icons, and the End combat flag, are from [game-icons.net](https://game-icons.net) (CC BY 3.0), by Lorc, Delapouite and contributors.
They are the same icons Atlas VTT uses, and pins show the same colours as in Atlas.
