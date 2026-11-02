# Tabletop for Atlas VTT

**Compatible with Atlas VTT 0.12.0** (TrueScale and the player window bar), and 0.11.

Tabletop for Atlas VTT is a community extension. It is not made, endorsed or supported by Atlas VTT or Atlas Online.

Opens Atlas VTT maps on a 3D board in Obsidian. The map image becomes a table, and tokens and note pins stand above
where they are on the map. Tokens can carry 3D minis (GLB) and props can be placed on the board. Players joined
through Connect for Atlas VTT or Atlas Online see the minis too, if they have Tabletop installed. Tabletop works the same
with either; it does not depend on one.

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
  to **Rotate 180°** it (it hangs from the other end and opens to the other side, as if turned half a turn about its middle) or **Mirror** it (only the hinge moves to the other end; it still opens to the same side), or to replace it with a prop from the gallery, which is fitted to the opening and swings the same way. How a door hangs is kept in Tabletop's data, so it shows on your board and the players' window, not on Connect players' 3D boards yet. A secret door
  looks like the walls around it; the GM sees a thin line on it, and on a one-way wall an arrow the way light passes,
  which players do not. Walls and doors under the fog of war are hidden from players. Right-click a wall to set its
  own height (or the whole wall's), in quarter squares, or **Ctrl + drag** it up or down (with Shift held when you let
  go, the whole wall); until set it stands as tall as the fog.
- **Importing minis:** the gallery's **Import** button, or dropping files on it, takes `.glb` files, a HeroForge
  **Unity3D** export (the `.unity3d` file, or the zip HeroForge gives you), a TaleSpire creature (`root.tsMod`, or the
  zip from mod.io), and zips of them. These are converted inside Tabletop to a `.glb` in your minis folder, with their
  colour picture (and, from Unity, normal, metal and smoothness, occlusion and glow pictures; at most 1024 pixels
  wide), and then work like any other mini, including for players. They stand in the pose they were exported in:
  skeletons and animations are not read.
  - **Unity3D:** bundles must come from Unity 2019 or later, with DXT1 or DXT5 pictures (what HeroForge writes).
  - **TaleSpire:** TaleSpire does not document `.tsMod`. Tabletop reads the layout of the creatures it has been tried
    on (a mesh, a colour map, and a normal map or a mask when there is one), checks everything it assumes, and refuses
    a file that does not fit with the reason. A creature that adds more (several meshes, other picture formats) may
    be refused. TaleSpire creatures have no base: see **Bases** below.
  - Anything else is refused with the reason. Check HeroForge's and the creator's terms before sharing a mini outside
    your own table.
- **Bases:** a mini made without a base (every TaleSpire creature) can stand on one drawn under it: right-click its
  token and choose **Round base** or **Square base** (choose the one that is set to take it away), or pick one in
  **Assign mini…**, which also shows the mini standing on its token's square at the size, turn and base you choose,
  so you can judge the size against the square. The base is a thin dark coin as wide as the token's square, kept with the mini's assignment. Players
  see it once Connect for Atlas VTT passes the base on (Tabletop offers it as `base` on each placement).
- **Materials:** the gallery's **Materials** tab imports texture sets as Poly Haven gives them (the zip, its maps, or a
  folder of them), kept in `atlas-vtt/assets/materials`. Drag one onto a wall or door to paint that segment; hold
  **Shift** to paint the whole wall (the segments drawn in one stroke, or else those joined end to end up to a
  junction or a door). Or click a material, then click walls on the board (Esc stops). Right-click a wall to take its
  material off. Right-click a material in the gallery and choose **Edit material…** to open a live 3D preview of a wall in
  that material, lit from the side (move the pointer to move the light; drag to turn the view, right-drag to move it, scroll to zoom), and set how many grid squares one tile of its
  texture covers and how strongly it shows: **Relief** (the normal map's strength, up to four times as made), **Crevices**
  (how dark the occlusion map makes the gaps) and **Shine** (glossy light that picks out the relief) and **Depth** (parallax: the texture shifts as the camera moves, so bricks stand proud of their mortar; it reads the height map, Poly Haven's `_disp_` file, and costs some speed on big maps) and **Displacement** (the wall itself is pushed in where the height map is low, so mortar lines and gaps really recede and show from the side; walls using it are cut into many more triangles, so it is heavy on maps with very many walls: it is off on Low quality, coarse on Medium and fine on High, and a material with a small texture tile is cut finer) and **Outward** (which way Depth and Displacement go: 0 sinks the dark parts in, 1 makes the high parts stand out of the wall). A material with no normal map gets its relief worked out from its height map, or its colours, when Relief is raised above 1. **Reset texture**
  puts the strength back as made. Kept in the material's folder, as `material.json`. Players see the strength once
  Connect passes it on (Tabletop offers it as `tuning` on each material).
- **Lights:** Atlas's lights (placed, and carried by tokens) shine on the board with their colour, bright and dim
  radii, and flicker (in the dark). The toolbar's **Lighting** button (the bulb) has an ambient light slider: lower
  it and the map goes dark; it starts at Atlas's ambient light when the map has Atlas's lighting on. A **Tint** colour next to the slider colours the board's daylight and the sky behind it (a warm gold, a cold blue); **Reset** takes it off. It is kept per map and goes to Connect's players. Atlas's lights keep their own colours. Right-click a light's bulb, or a
  token carrying one, to set how high it hangs, or **Ctrl + drag** a bulb up or down. The lights nearest where the camera rests cast shadows (none on Low
  quality, 2 on Medium, 4 on High).
- **Wall edges:** a setting (in the board settings, the wall button on the toolbar beside Wall thickness, and in Settings, Tabletop) for how round the edges of walls and doors are: **Sharp**, **Soft** (the default, a little rounding that catches the light) or **Rounded**. Walls that carry straight on into each other stay flush at the join.
- **See-through walls:** a setting (the board settings on the toolbar, and Settings, Tabletop) that fades the walls between the camera and the point it turns around, so a wall in front never hides the action. It cuts a soft, dithered hole along the line of sight, a cone that is as wide as the slider says (1.2 squares to start) at the point the camera looks at and up to three times wider at the camera, leaving a faint ghost of the wall; shadows are unchanged. It is off by default.
- **Line of sight:** a setting (the board settings on the toolbar, and Settings, Tabletop) that hides what stands behind walls and shut doors, as Atlas's dynamic lighting does, from every token that has vision on (the tokens Atlas treats as seeing). **Players** hides it from the players' view only; **Everyone** from your board too; it is off by default. It uses Atlas's rules for what stops sight: a shut door, a secret door and a solid wall stop it, an open door and glass let it through, a curtain stops it, a one-way wall stops it from its marked side, and a limited wall lets the first one through and stops at the second (the dark blocks treat a limited wall as open). A hidden token's vision does not count, and nothing is hidden while no token has vision on. The board is tiled by its grid squares, and every square no token that sees has in sight (an angular sweep from each viewer, so a doorway shows a cone of the room behind it) is covered by a dark block as tall as the walls, so its floor, walls, props, minis and pins are not shown. It is recomputed only when a token that sees, a piece or a door moved, and runs of squares are one block, so it stays cheap even on big maps. Vision range and darkvision are not read yet: sight is as far as the walls allow. **Sight style** (next to it in both places): **Rays** is the above; **Cinematic** judges whole rooms instead. A token in a sealed building sees all of that building and nothing outside; once a door of it is open it sees the whole outside as well, except every other sealed building, which stays black as one piece until a door of its own opens. (The squares are joined when a line across their shared edge is clear, so a door that is not on the grid's lines still opens the way.) **Elevation layers:** while line of sight is on for your board (Everyone, or a point of view), the scenes stacked above the one you opened are drawn as black shadows (their image in black, as solid or faded as the Upper layers setting says, and not at all under Hidden; nothing standing on them shows) and the ones below stay as they are. **Preview POV:** right-click any token and choose **Preview POV** to see your board from that one token's point of view, whatever the setting and whether or not it has vision on; a chip over the board says whose it is, and **Stop POV** (the chip's button, or the same token's menu again) ends it. It is your board only: players are not affected.
- **Elevation layers:** stack one scene on another for an upper floor, a balcony or a bridge. In the 3D board, click the layers icon on a scene's tab (or right-click the tab) and choose **Make a layer of…** to pick the scene underneath; the same menu changes the elevation one square at a time or takes the scene out of the stack. With two or more scenes in a stack, a **height ruler** runs down the right of the board, as in TaleSpire: a vertical rail whose top is the highest scene and whose bottom is the lowest, a dash on it every two squares of height (the **Layer ruler step** setting in Settings, Tabletop, from half a square to ten), and a marker on each scene at its elevation with its name, the shown one a lit diamond. Click a marker, or anywhere on the rail (or drag along it), to show the nearest scene. It does not reload the board (no new graphics context): the scene changes at once, the camera keeps the floor it was on and glides to the new one, and Atlas follows in the background. **Tokens to another scene:** drag a token (or a group you selected) onto another scene's pill on the ruler; the pill lights up as you carry it over, and dropping it sends the token there. It lands in the middle of that scene's board, or, where that place is taken, on the next free square of a spiral round it (right, down, left, up, each leg a step longer, leaving room for its size), and it leaves the scene you drag it from, with its mini and its look. Atlas holds the scenes: the token is added to the other scene first (through Atlas's store when it has that scene open, else in its file) and only then removed, so a failure leaves it where it was. **Adjust position:** a scene's height is not all of where it stands. Right-click a scene's pill on the ruler and choose **Adjust position** to slide and turn it on the plane: handles appear in the middle of the view at that scene's height, two arrows and a square to slide it and a ring to turn it about their middle. The turn snaps to a quarter turn (90 degrees) by default; hold **Shift** to snap to 45 degrees, **Ctrl** for 5 degrees, or **Alt** for no snap. The scene moves as you drag and is kept when you let go. A chip over the board names it, with **Reset** (back where its grid puts it) and **Stop**; the pill's menu says **Stop adjusting** too. The base scene is the reference and never moves: every other scene is placed against it (in its frame, so it lines up whichever scene you play), and you adjust a scene while you are on another one. The file's right-click menu in Obsidian (**Elevation layer…**) does it too, with any elevation (a scene stacked on a layer joins that layer's stack; negative goes below). Opening either scene in 3D then shows the whole stack: the scene you opened is the one you edit and play, and the others are drawn read-only at their height, each with its walls, doors, props, lights and minis. Transparent parts of a layer's image show what is below. The **Upper layers** setting (board settings on the toolbar, and Settings, Tabletop) draws the image of a scene stacked above the one you are on **Solid**, **Faded** or **Hidden** (only what stands on it); the scene you are on, and the ones below it, are always solid (their transparent parts still show what is below). Layers line up by their grid. The stack is the GM's to edit: players see the scene you present. **With Atlas VTT Connect** (0.9 and later), the players' 3D board also draws the other scenes of that scene's stack: each floor, with its walls, doors (as you hung them), lights and props, at its height and place, in the way the Upper layers setting and line of sight show them. Players never get what is on those scenes (tokens, pins, notes, fog), and a stacked scene is not hidden by its own fog, so players see all of its walls and floor. **Show layers to Connect players** (Settings, Tabletop) turns that off. Players have no ruler to switch scenes, and tokens on a stacked scene are shown only while you present that scene.
- **Lighting menu:** the toolbar's Lighting button chooses the board's look: **Classic** (plain white light), or
  **Painted** under a dusk, day or night sky (warm sun and cool shadows, a painted sky round the table that turns with
  the camera, the floor fading into it; tilt the camera nearly level to see the horizon). The same menu has the
  ambient light slider, **Miniature look** (a tilt-shift blur towards the top and bottom edges) and **Contact shadows**
  (darker creases where walls, minis and props meet the floor). They cost some frame rate on slow graphics cards.
- **Groups of tokens:** Shift-click tokens to select several (rings show under them) and drag any to move them all.
  A bar over the board turns them (45° a click), hurts or heals each one that tracks HP by an amount, or clears the
  selection (Esc does too).
- **Turns:** while a fight runs, a green ring shows under whose turn it is, a banner flashes when the turn passes, and
  a clock marks a combatant holding its turn back.
- **Animated maps:** a map whose background is a `.webm`, `.mp4`, `.m4v`, `.ogv` or `.mov` plays on the board, muted
  and looped, in its own size.
- **Small panes:** when the pane is too narrow for the toolbar, the tools farthest from the Move group go into a
  **More tools** menu.
- **Notes:** click a pin to open its note in a new tab. From a note, the command **Copy a link that opens this map
  in 3D** gives a link that opens it (`obsidian://tabletop-board?...`); **Save a snapshot of the 3D board** saves the
  picture in `Tabletop snapshots/` and copies its embed; and a code block
  ```` ```tabletop ```` holding `[[Maps/Cave.atlasmap]]` shows a card with the map's latest snapshot and an **Open in
  3D** button. Atlas's own map toolbar gets an **Open in 3D** button too.
- **Props:** open the gallery (**Open minis gallery**) and go to the **Props** tab. Click a prop, then click the board
  where it should go. **Ctrl + drag** moves a prop, and right-clicking one removes it.
- **Folders:** minis live in `atlas-vtt/assets/minis` and props in `atlas-vtt/assets/props`. Both can be changed in
  the settings.
- **Dice:** the **Dice** button on the board's toolbar opens Atlas's dice tray. Pick dice (right-click a die for its
  colours, each with how many of it are in that colour, and to roll it with advantage or disadvantage), a modifier and advantage, then **Roll**: the dice are laid
  on the table where the camera looks. Press a die and drag to carry it, and let go to throw it; **Ctrl** and a press
  gathers every die into one throw, and **Throw all** throws the rest. Dice bounce off tokens, props and walls, and
  only the map's edge stops them. Dice still to be thrown carry a line round them. A die caught on an edge gives no
  number and asks to be thrown again; an exploding die asks for another. Once every die has landed, the roll goes to
  Atlas's roll log (and again whenever a die is thrown again). Formulas may be `4d6kh3`, `5d10>=8`, `2d6r<3`, Fate
  dice (`4dF+1`, thrown as d6s: two faces minus, two blank, two plus) and labels (`2d6[fire]+1d6[cold]`); dice a roll
  sets aside (dropped or thrown again) are dimmed on the table and struck through in the log. The **Dice log** and **Stat sheet** buttons beside it
  show the rolls on the map and the selected token's sheet. A sheet's roll lays its dice on the table for you to throw; tick
  **Throw stat sheet rolls automatically** under **Board settings** (the command button) to have them thrown at once. It covers the sheet drawer and the stat block that Ctrl (Cmd) + hover opens, Atlas's own
  window included. The sheet drawer has a **pin**: pinned, it stays open under the other panels; unpinned, opening another
  panel (Board settings, lighting, the dice tray) closes it. The pin is remembered across reloads. Dice packs are read
  from `.obsidian/atlas-dice-packs/`, shared with Interactive Dice for Atlas VTT. Players' windows never show the
  GM's dice; with Connect for Atlas VTT, players throw their own on their 3D view.

GLBs must be self-contained and uncompressed (no Draco or Meshopt).

### Large maps (Atlas 0.11, Mosaic Canvas)

Atlas 0.11 takes maps of up to 1,000 megapixels and 65,535 pixels a side, with up to 20 million squares in a scene. A map
file of 8 MB or more is read through Atlas's own tiles when an Atlas map view is open: the board gets a picture of the
whole map (at most 8,192 pixels on its longer side, or what the graphics card takes) and keeps the map's true size for
tokens and the grid. If Atlas is still cutting a huge map's tiles, the board shows a quicker, smaller picture first
instead of waiting. Smaller maps, and any Atlas before 0.11, are read as the file, as before. On a map of millions of
squares a solid or dashed square grid is drawn as whole lines, a hex grid too fine to draw cell by cell is left off, and
cell numbers are worked out for the cell under the pointer, never listed.

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
node harness/make-test-video.cjs <dir>/sweep.webm      # the clip the animated map check plays (needs Playwright's ffmpeg)
node harness/features-test.cjs <dir> <screenshot dir> [feature regex]   # the checks of the features added since
```

The features checks drive the real board with real clicks and keys, check the DOM and the drawn picture, and save a
screenshot for each feature (the turn banner, the group bar, the animated map, the narrow toolbar, the light theme, the
snapshot card, Fate dice, auto roll). They print one line per check and exit 1 when one fails.

The harnesses use Playwright's Chromium: install `playwright`, or point `PLAYWRIGHT_MODULE` at an installed copy.

Player board harness (Tabletop's 3D board as Connect for Atlas VTT mounts it in a player's tab):

```
npx esbuild harness/playerBoard.ts --bundle --outfile=<dir>/playerBoard.js --alias:obsidian=./harness/obsidian-stub.ts --loader:.png=binary
sed 's/board\.js/playerBoard.js/' harness/board.html > <dir>/playerBoard.html && cp styles.css <dir>/
node harness/playerBoard-test.cjs <dir> <screenshot dir>
```

## Language

Tabletop's panels are in English, as Atlas's are: Atlas ships no translations, so Tabletop adds none. The layer is in place
(`src/i18n.ts`; the newer controls already read their words through it), so a language can be added with one table once
Atlas offers it.

## License

[AGPL-3.0](LICENSE), as Connect for Atlas VTT.

## Credits

The dice's shapes, faces and pack format come from [Interactive Dice for Atlas VTT](https://github.com/evolJoaoBento/atlas-physical-dice) (MIT).
3D with [three.js](https://threejs.org) (MIT) and physics with [cannon-es](https://github.com/pmndrs/cannon-es) (MIT).

The pin and condition icons, and the End combat flag, are from [game-icons.net](https://game-icons.net) (CC BY 3.0), by Lorc, Delapouite and contributors.
They are the same icons Atlas VTT uses, and pins show the same colours as in Atlas.
