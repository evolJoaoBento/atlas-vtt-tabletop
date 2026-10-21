# Tabletop dice: physical dice on the 3D board

Status: awaiting approval — 2026-10-21

## Intent

Rolling dice should feel like rolling on the table you are looking at. The GM on Tabletop's 3D board and a player in
Connect's 3D player view throw real, physical dice that land in the middle of what their camera sees, on the table's
surface. It should feel the same as Interactive Dice for Atlas VTT (drag to throw, the same dice, the same texture packs),
but live inside the 3D scene instead of over the notes.

## Decisions made by the user

- **Both GM and player.** The GM's 3D board and the player's 3D view (Tabletop's `playerBoard`, driven by Connect) both
  get dice.
- **Where they land:** on the table surface (the plane y=0) at the camera's centre, `camera.pose.target`.
- **Only the thrower sees the tumble.** No dice animation goes over the wire. Everyone else sees the result in Atlas's
  roll log and toast (GM) and Connect's dice log (players), as today.
- **The landing decides the number**, for players too. A player's roll is no longer re-rolled by the GM's Atlas; the
  player sends the values the dice landed on. This gives up today's guarantee that a player cannot fake a roll; the user
  accepted that.
- **Independent plugins.** Tabletop has its own dice; Interactive Dice stays its own plugin and keeps working with or
  without Tabletop. Neither requires the other.
- **One shared packs folder.** A pack added once shows up in both plugins.
- **Caught dice give no number.** A die that settles without a clean face up is "caught": no value is read, the player
  is told which die to roll again (for example "d20 caught: roll it again"), and the total waits until every die reads
  cleanly. This applies to Tabletop's dice **and** to Interactive Dice.
- **Exploding dice are thrown, not simulated.** When the collection's rules make a die explode, the thrower is asked
  to throw another physical die of that type ("d6 exploded: throw another d6"), and the total waits for it. Atlas's
  other rules (the critical rule) are worked out on the landed values the same way Atlas would.
- **GM throws show only on the GM's own view**, never on Tabletop's player window (the pop-out screen players watch).
- **The GM's board gets the dice log and stat sheet that Connect's player view has** (my reading of "add the dice log
  and statsheet connect player view has"; Connect's player tab already shows both around the 3D player view): a dice
  log panel with a toggle and a toast for each roll on this map, and a sheet drawer showing the stat blocks of the
  selected tokens, styled like Connect's.

## Calls I made (the builder may revisit; the user should check these)

- **Which map a GM roll is logged on:** the Atlas map view showing the board's map (matched by map path); if none is
  open, the most recently used map view, as Interactive Dice does. Never several maps at once.
- **Sheet rolls in the 3D views are physical too:** a roll from a stat sheet asks for the dice it needs (advantage or
  disadvantage throws two d20s and keeps one, as Atlas does).
- **Players' packs:** each player's dice use their own vault's shared packs folder and their own pick; only colour names
  travel. No textures are sent.
- **No collisions with pieces:** dice roll through tokens, minis and props; only the table and the throw box stop them.
- **Modifier:** the GM picker has a +/− modifier, like Connect's player tray; `modifier` travels with the result.
- **Stock Atlas must not animate its own dice** for these results (the stock roll carries `min: 1`, as Interactive Dice
  sends it).

- **Shared folder location:** `<vault config dir>/atlas-dice-packs/` (normally `.obsidian/atlas-dice-packs/`). Today
  the packs live in Interactive Dice's plugin folder, which is deleted with the plugin; a neutral folder keeps the two
  plugins independent. Interactive Dice moves its existing packs there once (copy, then leave the old folder alone — no
  deletion). Each plugin writes the bundled default pack there if it is missing. Pack format unchanged
  (`dice/README.md` in Interactive Dice).
- **Throw is screen-relative.** The camera tilts and orbits, so a flick up the screen throws away from the viewer along
  the camera's ground direction (the camera's forward vector projected on the table); a flick sideways throws along the
  camera's right vector. Release velocity sets impulse and spin as in Interactive Dice.
- **Dice size follows the map.** Tabletop works in map pixels. A die's edge is a setting in grid squares (default 0.6
  of a square), so dice read well against tokens at any map scale. Physics runs in die-scaled units and is mapped into
  map pixels, so tuning carried from Interactive Dice (gravity, damping, restitution) keeps its feel.
- **The tray:** invisible walls form a box around the landing point, sized from the visible table area at that point
  (clamped to a range in grid squares), so dice stay on screen. The map's walls do not stop dice.
- **Where you pick dice:**
  - GM board: a Dice button in the board toolbar's end slot (next to Connect's), opening a picker like Interactive Dice's
    controls panel (count per die type, colour via right-click, Roll). Dragging a die out of the picker throws it, as in
    Interactive Dice.
  - Player 3D view: Connect's existing Dice control and tray. When the board is 3D and Tabletop has dice, the tray's Roll
    throws physical dice on the board instead of asking the GM to roll. The 2D view and the web page keep today's
    GM-rolled flow unchanged.
- **Results to Atlas (GM):** the same stock route Interactive Dice uses on vanilla Atlas (map view's event bus
  `dice-rolled`, with colour and name tags), so it reaches the roll log, toast and player view. Atlas's own 3D dice must
  not also animate. The extension `ext.dice.publish` route is kept only if present.
- **Results from players:** a new Connect message, player → GM:
  `{ v: 1, type: 'dice-result', rolls: [{ die: 'd4'|'d6'|'d8'|'d10'|'d12'|'d20'|'d100', value, color?, exploded? }], modifier, kept? }`
  (`exploded` marks a die that earned an extra throw; `kept` names the advantage/disadvantage pick for sheet rolls).
  The GM validates it (at most 20 dice, values within each die's range, same rate limit as `dice-roll`), publishes it to
  Atlas under the player's name through the same stock route, and the existing `dice-log` reaches every player with
  `mine` for the roller. A GM on an older Connect ignores the unknown message, so the player's tab falls back to sending
  `dice-roll` when the GM has not announced support (a capability flag in the welcome/scene info).
- **Caught detection** keeps Interactive Dice's rule (best face normal against up — down for the d4 — below
  `1 − faceDetectionTolerance`), re-checked while the die micro-settles. Rerolling a caught die is a click (or drag) on
  that die; other dice stay where they lie. No code path may substitute a random number for a caught die or for a die
  with no mesh; today Interactive Dice does in `getTopFaceNumberForDice` and the no-mesh branch of `checkDiceResult`.
- **Clearing:** dice stay on the table until the next roll, a click on Clear in the picker, or the scene changes.
- **Settings in Tabletop:** a "Dice" section with die size (squares), pack, shadows, highlight on settle, face detection
  tolerance, motion threshold. Lighting comes from the board's own lights, not Interactive Dice's light settings.

## Goals

- Physical dice on the GM's board and in the 3D player view, landing at the camera's centre on the table.
- Same dice types (d4, d6, d8, d10, d100 as percentile d10 pair, d12, d20), geometry, UVs and pack textures as
  Interactive Dice; colours per die.
- Results reach Atlas (GM) and Connect's dice log (players).
- Caught dice give no number and prompt a reroll of that die, in both plugins.
- Shared packs folder, with the Atlas asset manager "Dice packs" tab still working from Interactive Dice.

## Non-goals

- Sending the tumble to others, or replaying it.
- Dice on Connect's 2D view or the web join page (they keep the GM-rolled flow).
- Formula parsing beyond counts, a flat modifier, exploding dice and advantage/disadvantage.
- Showing GM throws on Tabletop's player window.
- Sounds (Interactive Dice has none).
- Any change to Atlas itself (vanilla Atlas only).

## Anti-goals

- Tabletop must not require Interactive Dice, nor Interactive Dice Tabletop.
- Never invent a number: a caught or unreadable die never yields a value.
- Dice must not hurt the board's frame rate when idle: physics and extra frames run only while dice move.
- Bundling a second three.js into Tabletop. Tabletop's dice use Tabletop's three 0.185; Interactive Dice keeps its own.
- Copying Atlas's AGPL code or images.

## Constraints

- Tabletop: three 0.185, esbuild, node:test units, Playwright/swiftshader harness. Physics: cannon-es 0.20.0 (as
  Interactive Dice), added as a Tabletop dependency.
- Connect wire protocol v1; new message validated like the others; older peers keep working.
- Pack textures are local files from the shared folder; nothing fetched from the network.

## What's left to the builder

- How to factor the dice code: extract Interactive Dice's geometry, UVs, physics shapes, face normals and pack loading
  into a module Tabletop vendors (copied, not imported across plugins), versus rewriting against three 0.185. The API
  difference between three 0.156 and 0.185 decides how much carries over.
- Tray sizing details, throw strength tuning, shadow approach on the board (the board has real lights; blob shadows may
  be unnecessary).
- Picker layout within Atlas's toolbar style.
