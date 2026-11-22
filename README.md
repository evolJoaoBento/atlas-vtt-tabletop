# Tabletop for Atlas VTT

**Compatible with Atlas VTT 0.15.0 to 0.18.0.** Needs Atlas VTT 0.15 or later, and Connect for Atlas VTT 0.15.0 (the same fusion release).

**Atlas VTT 0.16's drawings and texts** are read the way Atlas reads them: a drawing, text or stamp you hide from your players in Atlas is drawn on your board but never in the players' window, nor on a player's board; filled shapes (solid or soft, with the holes you cut), lines of no width, stamps by any pin symbol and turned stamps are drawn as Atlas draws them, in Atlas's order. Not yet: dashed lines, arrowheads, the outline look of a text, and wrapped text (drawn on one line).

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
- **Sight follows Atlas:** on a scene whose dynamic lighting is on, what players are shown is Atlas's own answer, read from the Atlas tab that holds the map (the reader Atlas VTT Connect sends players from): the tokens Atlas shows them, and the map where they see it (Atlas's senses, light, walls, conditions and explored memory). In your player window everything else is covered by dark blocks as tall as the walls, so its floor, walls, props, minis and pins are not shown. Your own board shows everything, as Atlas's GM view does; the **GM view** switch at the end of the toolbar (Play and Edit mode, Atlas's own D key with Shift on the board) turns it into Atlas's session view, the map as players see it (hidden tokens gone, the fog opaque), and is the same switch as the Atlas tab holding the map. While Atlas has no answer yet (its tab is loading, on another map or another level, or the lighting is being switched), players are shown nothing; with lighting off, no sight is drawn. **Elevation layers:** under a point of view, and in a player's picture, the scenes stacked above are drawn as black shadows (their image in black, as solid or faded as the Upper layers setting says, and not at all under Hidden; nothing standing on them shows) and the ones below stay as they are. **Preview POV:** right-click any token and choose **Preview POV** to see your board from that one token's point of view: Atlas's sight of that token alone, on a lit scene; a chip over the board says whose it is, and **Stop POV** (the chip's button, or the same token's menu again) ends it. It is your board only: players are not affected. (Tabletop's own Line of sight and Sight style settings went with this: sight is Atlas's.)
- **Floors (Atlas levels):** a scene's floors are Atlas's levels: add an upper floor, a cellar or a balcony in Atlas, and the 3D board shows them together. The level you are on is the one you edit and play; the others are drawn read-only at their height, each with its walls, doors, props, lights and minis. Transparent parts of a level's image show what is below. A **height ruler** runs down the right of the board, as in TaleSpire: a vertical rail whose top is the highest level and whose bottom is the lowest, a dash on it every two squares of height (the **Layer ruler step** setting in Settings, Tabletop, from half a square to ten), and a marker on each level at its height with its name, the shown one a lit diamond. Click a marker, or anywhere on the rail (or drag along it), to show the nearest level. It does not reload the board: the level changes at once, the camera keeps the floor it was on and glides to the new one, and Atlas follows to the same level. **Tokens to another level:** drag a token (or a group you selected) onto another level's pill on the ruler, or let it go over that level; it moves there through Atlas's store, with its mini and its look. Right-click a level's pill to hide it on the board or show it again (Atlas sets its height and its order). The **Upper layers** setting (board settings on the toolbar, and Settings, Tabletop) draws a level above the one you are on **Solid**, **Faded** (half see-through) or **Hidden**, its walls, doors, props, lights and minis with it; the level you are on, and the ones below it, are always solid. **With Atlas VTT Connect**, the players' 3D board also draws the scene's other levels: each floor, with its walls, doors (as you hung them), lights and props, at its height, in the way the Upper layers setting and line of sight show them. Players never get what is on those levels (tokens, pins, notes, fog). **Show layers to Connect players** (Settings, Tabletop) turns that off. **Scene stacks from before:** Tabletop used to stack whole scenes on one another (elevation layers) in its own data. Those stacks are not drawn any more; they become Atlas levels of their base scene when you say so. At each start, while any is left, a notice offers **Review and move** (or the command **Move scene stacks to Atlas levels**): the review lists each stack's levels to be and what will not be kept, then **Move** or **Later**. Move first writes a backup of every scene and of Tabletop's data for it (`Tabletop backups/<date>/`, with a note of what was done), then makes each stacked scene a level of its base through Atlas itself: its image fitted to the base's grid, its tokens, walls, doors, lights, pins, drawings, fog, measures, liquids and features on that level, its minis, token looks, props and cutscene shots following. The stacked scenes stay as scenes of their own. Not kept, and said in the review: a scene's turn on the plane (Atlas turns no level) and a place left of or above the base's corner (it is set at the nearest squares to the right or down), what players had explored on it, its initiative order, and its own fog height, wall thickness and lighting where they differ from the base's. Nothing is moved while Connect hosts a session or a cutscene runs. A scene can still be taken out of an old stack from its tab's menu (**Remove from stack**) instead.
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
- **Props:** open the gallery (**Open Tabletop Gallery**) and go to the **Props** tab. Click a prop, then click the board
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

- **Atlas's toolbar tools on the board:** the toolbar has Atlas's **Random tables** (L), **Asset manager** (Shift+A; A moves the camera) and **Command palette** (Space), in the order you set in Atlas's toolbar (a tool you hid there is hidden here). They are Atlas's own windows, on the same data: the random tables roll your table notes and keep the same history as Atlas; the asset manager spawns tokens and encounters onto the board at the camera's centre (with Atlas's hit point rolls and formations), opens scenes on the board, and sends you to Atlas for the token creator, the encounter builder, new scenes and deleting tokens; the palette runs the board's tools and opens Atlas's own palette for Atlas's settings. They need Atlas VTT with the map open in Atlas for its library. See `docs/atlas-parity.md` for how they follow Atlas.

## Editing goes through Atlas

Atlas is where a map lives. Everything Atlas keeps (tokens, doors, walls, pins, the initiative tracker, the light level
and its tint) is edited through Atlas itself, so the board, Atlas and your players always see the same map. Tabletop
never writes a map file on its own.

- **One Atlas tab, one map at a time.** Atlas keeps a single tab with one map loaded. When you work on a board (you
  switch to its tab or click on it), Tabletop brings that Atlas tab to the board's map, in the background: the board
  stays in front. If no Atlas tab is open, Tabletop opens one behind the board and closes it again with the last board.
- **View only.** A board whose map Atlas is not holding shows the map and edits nothing of Atlas's. A bar says
  "View only. Atlas holds <map>." with an **Edit here** button, which brings Atlas to this board's map. With two boards
  on two maps open, the one you are working on is the one you can edit.
- **What still works on a view-only board:** everything that is Tabletop's own, since Atlas keeps none of it: minis,
  props and cutscenes. What you set on walls, doors and lights, and the water you paint, are Atlas's records now: they
  show on a view-only board, and changing them needs Atlas on that map.
- **If you close Atlas's tab** the bar says "Atlas closed this map. Editing is paused." with **Reopen**.
- **An edit Atlas cannot take** (Atlas does not come to the map) is not saved anywhere else: the board tells you and shows
  the map as Atlas has it.
- **Without Atlas** (not installed or not enabled) boards open to look at: "Atlas VTT is not enabled. View only."
- **Players** (through Connect) who move a token while your Atlas is on another map are told "The GM's Atlas is on
  another map; try again in a moment."

**Atlas 0.15's token height and movement.** A token stands at its height (Atlas's token height, set with + and − in
Atlas's token menu): so many squares over the floor as the map counts heights, with a thin line down to the floor under it. A
ruler from one token to another counts the height between them, as Atlas's ruler does. Where the collection has
movement steps (Atlas's collection settings, Movement), a dragged token's ruler reads "moved / speed" (for example
"20 / 30ft") in the colour of the step the move lies in, red past the last one; the speed is the token's own, its
statblock's or the collection's, as Atlas reads it. Whether a drag shows its distance at all follows Atlas's setting
(always, only in a fight, never). What a token already moved this turn is not added yet: each drag counts from its
start. Resources, who sees which bar, a token's side in a fight by sides, critical results and which faces of a die
explode are Atlas's own rules too.

**Spells and templates are Atlas's areas.** A spell that lasts, and a template, is one of Atlas's kept measures: it is
saved in the map, drawn in Atlas's own 2D view as a flat area, taken back with Atlas's undo (one step for a cast), and
reaches every player from there. The board draws a spell in 3D where its measure lies now, so one moved, turned or
resized in Atlas moves on the board; an area or a ruler kept in Atlas shows flat on the board too. What a spell's
rules stand is Atlas's as well: a wall spell and an obscuring area are walls of Atlas's (they stop its tokens and its
sight), difficult ground is a map feature with difficult terrain, and a light or a magical darkness is the area's own
light (a darkness on a round area only); they follow the spell and go with it. An instantaneous spell (Fireball) goes
off and is kept nowhere. What changed with it: a cast or a template needs Atlas to hold that map (the bar over the
board offers **Edit here**; without it the cast is refused and nothing is written); spells are kept, so the ones on a
map are there when it is opened again, standing and silent; a square template grows from the middle of its near side
and a line is one square wide, as Atlas shapes them; each player has one template at a time.

**What you set on a wall, a door or a light in 3D is kept on Atlas's own record.** A wall's or door's height, width
and material, a window's opening, the prop standing in for a door and how the door was turned, and how high a light
hangs (a placed light, or one a token carries) ride on that wall, light or token in the map itself. So they go when
it is deleted in Atlas, come along when it is copied, and are taken back by Atlas's undo (one step each). Maps made
before this are moved the first time Atlas holds them: a backup of the map and of Tabletop's data for it is written
to `Tabletop backups/<date>/` first, and a notice says what moved (Atlas's undo steps for that map from before the
move are let go then, once). Setting them needs Atlas to hold the map, as every other edit does; a board on another
map shows them and refuses the change. A material folder or a door's prop renamed in the vault is still found.

**Painted water is Atlas's liquids.** The water brush and bucket paint as before; when you let go, what you painted is
kept in the map as Atlas's own water (outlines that follow your stroke to within a sixteenth of a square), so Atlas's
2D view shows it in the same colour, flowing the same way, and Atlas's undo takes a stroke back. Atlas keeps 256
liquids on a level, of 2048 corners each: a lake with more than that has its smallest dry spots filled, then its shore
smoothed by a quarter of a square, then the islands in it filled, and only then its shore smoothed further; the
smallest patches past 256 are left out; a notice says so, and the board then shows what was kept. The board draws every liquid Atlas has on the level you are on, water, lava and acid
of a generated dungeon too, all as one water for now: in the colour and motion of the water you painted there, or,
where you painted none, still and in the first liquid's colour. The brush changes only the water it painted: a liquid
made in Atlas is Atlas's to change, and where you erase over it, it is drawn again when you let go. The water's motion
and colour are one for all the brush's water of a level. Water painted before this is moved, all of it, the first time
Atlas holds its map with the scene's first level shown, after a backup, with a notice; a mask that no longer fits the
map's image or grid (it was not drawn before either) stays in Tabletop's data until it does.

The light level and the tint in the lighting menu are Atlas's scene lighting (the same values as on Atlas's own
lighting page); the level can be set while the scene's lighting is on in Atlas. The laser's colour and size, and how
loud dice are, are Atlas's settings too.

Settings a map kept in Tabletop 1.3 are carried over once, with a backup in `Tabletop backups/<date>/` in your vault:
the heights, widths, materials and windows of the walls of an Atlas 0.14 room move to the walls Atlas 0.15 makes of that
room, and a map's own light level and tint are saved to the backup (the board is now as light as Atlas's scene).

## Sounds

The board has sounds for what it animates, played by each board for what it draws (nothing about sound goes over the
session, so a player hears the GM move a mini because their own board shows the mini sliding). They follow the camera:
quieter the farther from it, panned a little left or right by where they are on the screen. A board that is not on screen
(its tab behind another, or a hidden window) plays nothing, and nothing is queued for when it comes back. The laser
pointer, discovering the map through line of sight and a condition being removed are silent. The pop-out player window
plays no sound of its own: the GM's machine plays it once, placed by the GM's camera, and blows the turn horn at full
volume while that window is open.

- **Defaults:** every group on, volume 0.6.
- **Settings** (per device): under **Settings > Tabletop for Atlas VTT > Sound**, **Sound volume** and **Mute board
  sounds**, and one switch per group. The web player has no settings tab: its board has a speaker button in a corner with
  a volume slider and a **Mute** box, kept in that browser.
- **Groups:** *Dice* (a clack for each hit, and a dull thunk for a die caught on an edge; the clacks carry the roll, with no
  rolling loop), *Minis*
  (picked up and put down, each mini of a group on its own a few tens of milliseconds apart), *Spells* (an impact for each
  damage type when a spell is cast, and a quiet loop for each damage type while a lasting spell is near the camera; a
  lasting bludgeoning, piercing or slashing spell has no loop and stands silent),
  *Conditions* (a sound for each of the 5e conditions, matched by English name, with Portuguese and Spanish aliases, and a
  neutral tick for any other), *Turns* (the horn when a turn begins: full volume for the players who control that token and
  for the GM on a monster's turn, quiet for everyone else), *Fog* (a chime when the GM places fog), *Doors* (doors
  opening, shutting and rattling when locked; a wall material swapped crumbles) and *Water* (a loop for each way painted
  water moves, heard only when the camera is near it).
- **Credits:** every sound is from [Kenney](https://kenney.nl)'s CC0 packs, from the CC0 packs credited under Credits below, from
  Leonardo Calvo's CC BY 4.0 spell pack (credited there too), or made for this project; nothing else.
  `src/assets/sounds/SOURCES.md` lists each file, where it came from, its licence and what was changed, and how to rebuild
  them.

### Custom sounds

Any built-in sound can be replaced with a file of your own, without rebuilding anything.

- **The folder:** **Settings > Tabletop for Atlas VTT > Custom sounds folder** (default `Tabletop sounds`, created the first
  time something is written to it). A file named `<sound id>.<ext>` replaces that sound: `dice.hit.mp3`,
  `condition.prone.ogg`. Several variants are numbered `<sound id>-1.<ext>`, `<sound id>-2.<ext>`; they replace the built-in
  set as a set, and a random one plays each time. Accepted: mp3, ogg, wav, m4a, webm, flac.
- **The list:** under the Sound settings, every sound is listed by group with its name and when it plays, a play button,
  **Replace…** (pick a file; it is copied into the folder as `<id>.<ext>` in place of any older custom file for it),
  **Reset** (shown while it is custom; deletes the custom files) and a volume from 0 to 200 % for that sound alone.
- **Live:** adding, changing, deleting or renaming a file in the folder takes effect at once, also for a loop that is
  playing (it fades to the new file). A file that cannot be decoded is named in one notice, and the built-in sound plays.
- **Export built-in sounds** writes every bundled sound to `built-in/<id>-N.mp3` in the folder (for reference and editing;
  nothing in `built-in/` is ever used) and a `README.md` listing every sound id, its name and when it plays.
- **Who hears them:** custom sounds play on this computer, on the boards of this vault (and the local player window).
  Remote players (Connect's player tab in another vault, the web player) hear the built-in sounds for now.

## Cutscenes

A cutscene takes the camera away from the players for a while and shows them shots you prepared (or just what your own
camera does), then gives it back where it was. It needs **Connect for Atlas VTT with cutscenes** on your side and on the
players' (a player on a Connect without them, or without Tabletop's board, does not see the shots). On your own, with no
session, you can build and preview cutscenes all the same.

- **Cinematic mode:** the toolbar's mode switch has three modes, **Play**, **Edit** and **Cinematic** (a clapperboard).
  Choosing Cinematic opens the scene's cutscene gallery, and the toolbar shows only the mode switch and the **Players
  follow my camera** toggle (while a session hosts); Play's and Edit's tools are put away. Choosing Play or Edit closes the
  gallery or the editor (the work is already saved), and so does closing the gallery itself (its **×**, or Escape): the
  switch goes back to the Play or Edit you came from, so it never shows Cinematic with nothing open. Opening a cutscene
  from the gallery stays in Cinematic. A cutscene running for players keeps running when you switch to Play or Edit, and
  its **Previous**, **Next** and **End** stay on screen. Play and Edit are remembered between sessions; Cinematic is not,
  so a board opens in the last Play or Edit. It is the GM's mode: players' boards and the player window do not change.
- **Building:** in Cinematic mode, the gallery's **+**
  asks for a name and opens the timeline along the bottom of the board; the cinematic bars come on and your camera is
  free: **W/S** (or the up and down arrows) fly along the view, **A/D** (or left and right) across it, **Q** goes down and
  **E** up, dragging with either mouse button looks about, the wheel dollies in and out. There are no camera limits (look
  up, go as far as you like) and no roll. **Click the timeline** to make a shot holding the camera as it is at that moment;
  **drag** a shot to retime it. **Right-click a shot** to make it a *keyframe shot* (the camera passes through it without
  stopping; a chain of keyframe shots on one map is one smooth path) or back, **Preview from here**, **Update to current
  camera** or **Delete**. **Right-click between two shots** to pick the transition into the second: **Fade** (through
  black), **Cut**, or **Move** (the camera eases from one shot to the next; only between two shots on the same map). The
  time between two shots on the timeline is how long the transition takes. To cross maps, open the other map in an Atlas
  tab, switch to it while editing and click the timeline there: that shot belongs to that map. Everything saves as you go,
  in the map the cutscene was made in, and follows a renamed map. **Done** (or Escape) leaves.
- **Preview and Play for players:** **Preview** in the editor, or in the gallery, runs the cutscene on your board only, with
  **Previous**, **Next** and **Back to editing**. **Play for players** (gallery) starts it for everyone: it stops on each
  ordinary shot and waits for your **Next** (keyframe shots run straight through); **Previous** is a cut to the previous
  ordinary shot; **End** gives the camera back. The toolbar's **Players follow my camera** toggle is the live version: no
  shots, the players' cameras follow yours, smoothed, until you end it. While you build or preview, the local players'
  window keeps its last picture. Closing the board, stopping the session or unloading the plugin ends a run, and every
  player is back on their own camera.
- **Cinematic settings** (the gear in the gallery): **Cinematic bars** on or off, the **Aspect ratio** (1.85:1, 2:1 or
  2.39:1, the default), the **Default transition** for a new shot (fade, cut or move; fade by default) and the **Fade
  length** in seconds each way (0.6 by default).
- **What players see:** each player's picture fades to black, then fades in on the first shot, and fades out and back in
  on their own camera at the end (their own camera, token's eyes, AR placement or 2D pan and zoom, exactly as they left
  them; a player on Connect's 2D view is switched to the 3D board for the run and back). Everything the shots show, in the
  maps they show it, for the run only: the board as the GM's camera sees it, with no fog and no line of sight (hidden
  tokens stay hidden), also on a map the player was never shown. Nothing seen is kept as explored or remembered, and
  nothing of it stays in their data afterwards. During the run a player's camera and tokens do not move from any input
  (mouse, wheel, keys, touch, pinch, a token's eyes, AR); they can hover and click for information, and use **Roll dice**
  (the roll goes to your log). The cutscene scene is not part of the scene assignments and never changes who is where.

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

Board sounds:

- Magic Spell SFX by Leonardo Calvo ([The Sound Rack](https://thesoundrack.itch.io/freemagicspellsfx)), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The spell impacts and loops and many condition sounds are cut,
  faded, normalised and re-encoded from this pack.
- [Fantasy Ambient Sound Effects Pack](https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0) by kmontesdev (CC0), with
  thanks: the weapon hits, the cave and desert ambience under some spells, and a few condition hits.
- [Kenney](https://kenney.nl)'s Impact Sounds, RPG Audio and Interface Sounds (CC0).
- [2 dice roll (29 throws)](https://opengameart.org/content/2-dice-roll-29-throws) by RPG and
  [80 CC0 RPG SFX](https://opengameart.org/content/80-cc0-rpg-sfx) by rubberduck (CC0), on OpenGameArt: the dice clacks and the
  wall crumble.
- The rest is made for this project. `src/assets/sounds/SOURCES.md` lists every file with its source, licence and processing.
