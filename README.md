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

The pin icons are from [game-icons.net](https://game-icons.net) (CC BY 3.0), by Lorc, Delapouite and contributors.
They are the same icons Atlas VTT uses, and pins show the same colours as in Atlas.
