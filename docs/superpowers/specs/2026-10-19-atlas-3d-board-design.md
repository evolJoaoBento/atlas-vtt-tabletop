# Tabletop 3D board: design

Date: 2026-10-19. Status: draft for the user's approval.

## Intent

The user runs D&D sessions in Obsidian with Atlas VTT (stock Atlas 0.8.x, the vanilla plugin only). An earlier
extension, **Tabletop** (`C:\Users\joaoo\2075\atlas-vtt-tabletop`), stood 3D GLB minis on Atlas's own 2D map
and later laid Atlas's picture on a tiltable board. Fighting Atlas's renderer and DOM left too many compromises:
black space beyond the map, Atlas pop-ups misaligned on the tilted board, and input forwarded through
traced events. That approach is being shelved.

**The new plugin *is* Tabletop (user decision).** It replaces the old one entirely, keeping the plugin id
`atlas-vtt-tabletop` and the same repo (`C:\Users\joaoo\2075\atlas-vtt-tabletop`). The old overlay code is shelved
under a git tag before the rewrite starts. Tabletop no longer draws anything on Atlas's own 2D map: no overlay, no
3D table, no "Place mini…" entry in Atlas's token menu.

**Designer's call: keep Connect working.** Connect 0.5.0 (released 2026-10-19) gets players their minis through
Tabletop's public API: `plugins['atlas-vtt-tabletop'].api` v1 (`placementsFor`, `onChange`, `readMini`,
`playerMinis`), announced with the events `atlas-vtt-tabletop:api-ready` and `atlas-vtt-tabletop:api-unload`.
The new Tabletop keeps exposing that API from its own mini assignments, so players joined through Connect still see
the minis the GM assigns in the 3D view. Since the plugin id is unchanged, Tabletop's saved data, including the
existing assignments, carries over as is.

The new plugin takes the other route. It **reads an Atlas map file and draws it itself, in its own 3D tab**:
the map image is a board, and the map's elements stand or float a little above where they are on the map. The user
**runs sessions from this view** (the GM's working view, not a second screen for players). The aim is a table
that looks and feels 3D, with minis that feel good to drag.

## Goals (first version)

1. Open any `.atlasmap` in a new 3D tab. The map's background image lies on a flat board at the map's world size.
2. Show **tokens** and **notes (pins)** from the map, above their spots. No other element types yet.
3. **Move tokens** with a plain click-and-drag. The new position is saved into the `.atlasmap`.
4. **Assign a 3D mini** (GLB) to a token. The mini stands on the token and follows it.
5. **Props:** place GLBs straight on the board, not tied to tokens. They stay put until picked up
   with **Ctrl + click-and-hold** and set down somewhere else.
6. One **gallery** with two tabs, **Minis** and **Props**, each backed by its own folder.
7. Camera controls copied exactly from the user's TacticalEngine project (details below).

## Non-goals (first version)

- Element types other than tokens and pins: fog, walls, lights, drawings, texts, audio, light zones and so on.
  The user wants **all of them eventually**, so the code should be organised so each new type is one more layer.
- Live sync with Atlas or Atlas VTT Connect while the same map is open there. The user said **not now, but it
  will be needed in the future**. Design so a later sync can hook in; don't build it.
- A player view, or anything shown through Connect.
- Creating, editing or deleting any map element. The only write to the map file is a token's position.

## Anti-goals (what would make it a failure even if it works)

- **The drag feel of minis.** Dragging a token with a mini must keep Tabletop's motion: the mini leans away from the
  movement, lifts slightly while carried, springs back upright, and cross-fades its GLB's idle and walk/run clips.
  That motion lives in Tabletop's `src/figure.ts` (`MiniFigure`, with its constants). Reuse it as is.
- **Where a mini's stats sit.** It has to be the layout below, readable from any camera angle.
- Corrupting or rewriting a map file beyond the moved token's `x` and `y`.

## Constraints

- Obsidian desktop plugin, TypeScript, three.js (Tabletop already bundles three via esbuild).
- Target **vanilla Atlas only** (stock Atlas, plugin id `atlas-vtt`). Read its files; don't depend on patched Atlas internals.
- GLBs must be self-contained and uncompressed (no Draco or Meshopt). The same rule and error text as Tabletop's
  `library.ts` / `glbCheck.ts`.
- Vaults that must get the plugin, all under `C:\Users\joaoo`: `2075` (main), `atlas-player-vault`,
  `atlas-stock-test-vault`, `Obsidian/Atlas`.

## The map file (what is known)

`.atlasmap` files are JSON: `{ version, state }`. The fields that matter:

- `state.background`: the vault path of the map image. Elements are positioned in that image's pixel space.
- `state.grid`: `{ enabled, visible, snapToGrid, type: "square"|hex…, size, offsetX, offsetY, opacity, lineType, lineWidth, … }`.
- `state.objects`: an object of collections keyed by id: `tokens`, `pins`, `fog`, `texts`, `drawings`, `walls`, `lights`, `audios`, `lightZones`.
- A **token** carries `id, x, y, imagePath, name, kind, size` (grid cells), plus `rotation, isHidden, layer, showRing,
  ringColor, showNameplate, side, hp {current,max}, statblockResources {key:{current,max}}, conditions [ids],
  conditionValues {id:n}, difficulty, vision, light, statblockPath, instanceNumber`.
- A **pin** (note) carries `id, kind, x, y, notePath, icon` (e.g. quest, combat, boss, treasure, trap, npc, lore,
  secret, important, letter, pin, number), `hex, label, gmOnly, readable`.

Atlas's source for how these are drawn is next to the installed plugin:
`C:\Users\joaoo\2075\.obsidian\plugins\atlas-vtt\src`. For example, `services/statblockResources.ts` and
`react/components/statblock/StatblockTokenResources.tsx` cover resources, and the pin icon catalogue
(`pin.icon.*`, with a color per icon) is in the app code. The builder reads these to match Atlas's look and the
exact meaning of each field (token size units, x/y as centre or corner, how hidden tokens are faded for the GM,
condition colors).

## How it looks

**Board:** the map image on a plane at its pixel size, in world units, plus the grid drawn as Atlas draws it when
`grid.visible`. The frame and floor around it are the builder's call, but nothing should read as "black outside the map".

**Tokens** float slightly above the board at their spot:
- **Without a mini**, each token shows as either a **floating disc** (default) or a **standee**, chosen per token.
  - The disc is the token art as a thick coin lying flat, with a shadow under it.
  - The standee is the art as an upright cut-out on a round base.
- **With a mini**, the mini stands on the token's disc.
- Tokens hidden from players (`isHidden`) are shown **faded, the same way Atlas shows them to the GM**.

**What a token shows (everything Atlas shows):**
- **Name** at the top, with the **HP bar** directly under it, both above the mini's (or standee's/disc's) head.
- **Conditions** are **colored rings on the base**. Each extra condition adds a ring with a bigger radius so they don't
  overlap. Hovering a ring shows the condition's name.
- **Other stats** (AC, resources and so on) look **like Atlas's own badges**: a circle with a stepped ring and the
  number in it. They show no label; the name appears on hover. They are added **alternately left, right, left, right**
  beside the figure.
- The ring color (`ringColor` / `showRing`) and nameplate (`showNameplate`) follow the token's settings.
- Labels and badges face the camera so they stay readable at any angle. The pixel size is the builder's call, but
  they must stay readable while zoomed out.

**Pins (notes):** Atlas's own pin, with the same icon and color Atlas uses for that `icon`, floating over its spot with
the title on a label above it. **Clicking a pin opens its note in a new tab**; the map's tab is never replaced.
GM-only pins are shown (this is the GM's view).

Mockups agreed during the conversation (rough, for layout only) are in `mockups/` next to this document:
`tokens-notes.html` (the user picked disc and standee per token, and the map pin with a label) and `mini-stats.html`
(the stats layout). The user's correction to the latter is that the side stats are Atlas-style stepped circles with no
label, not the text pills drawn there.

**Calls made by the designer, not the user (check these):**
- *Which badges and labels a token shows* follows Atlas's own rules for what it draws on that token on the map:
  the nameplate only when `showNameplate` (falling back to `statblockName` like Atlas), and HP only when Atlas
  shows it. It covers the same resource badges, with the same labels, that Atlas shows next to the token, including
  `stress`/`hope`/`difficulty` when Atlas shows them. Where Atlas gets a label or value from the linked statblock
  note, reuse Atlas's logic for it (read-only) instead of inventing a new source. The layout (name, then HP,
  then condition rings, then side badges) applies to whatever subset is shown.

## Interaction

**Camera: exactly TacticalEngine's** (`github.com/evolJoaoBento/TacticalEngine`, `src/engine/render/camera.ts`
and the input code in `src/main.ts`). Port the `OrbitCamera` class (goal/pose with exponential damping 10, settling
exactly so a still camera stops redrawing) and `pitchFloor`. The limits must be rescaled from TacticalEngine's world units
to this board's size, keeping the same feel.
- Left-drag on empty board: orbit (`orbit(-dx*0.006, -dy*0.004)`). Middle-drag: orbit.
- Right-drag: pan, at `distance*0.0016` per pixel, relative to the current yaw.
- Wheel: `zoom(exp(deltaY*0.0012))`. Zooming out raises the pitch floor so the far view reads as a map.
- WASD / arrow keys pan; Q / E turn (1.6 rad/s); Home frames the whole map.
- A press that moves under 6 px is a click, not a drag.

**Board interactions:**
- **Left-drag on a token** moves it, with the `MiniFigure` motion. Snap to the grid on drop when the map's
  `grid.snapToGrid` is on, as Atlas does. On drop, write only that token's `x`/`y` into the `.atlasmap`.
- **Click a pin**: open its note in a new tab.
- **Right-click a token**: a menu with "Assign mini…" (opens the Minis picker), "Remove mini", and "Show as disc" /
  "Show as standee". Right-*drag* still pans.
- **Ctrl + click-and-hold on a prop**: pick it up, move it, and set it down on release.

## Minis, props and the gallery

- **Minis folder:** `atlas-vtt/assets/minis`, the same folder Tabletop uses. **Props folder:** `atlas-vtt/assets/props`
  (builder's call; configurable in settings like Tabletop's folder setting).
- **The gallery** is one Obsidian view with two tabs, **Minis** and **Props**. Each tab lists its folder and supports
  importing GLBs into it. This is Tabletop's gallery (`src/gallery.ts`, `src/library.ts`) with a second tab.
- **Persisted in the plugin's own data, never in the map file:**
  - mini links per map and token (`mini, scale, turn`, the same shape as Tabletop's `assignments.ts`)
  - the disc/standee choice per map and token
  - props per map (`glb path, x, y, rotation, scale`)
- **Existing mini assignments carry over.** Old Tabletop kept them in its own `data.json` under `assignments`
  (map path → token id → placement). The new Tabletop has the same plugin id, so it reads that data directly. Keep the
  format compatible, or migrate it in place.

## Saving token moves

- Write with Obsidian's vault API as a read-modify-write of the file's JSON. Change only `state.objects.tokens[id].x/y`
  and keep everything else byte-for-byte where possible (indentation, key order).
- If the file changes on disk while the 3D tab is open (for example Atlas saved it), reload the board from the file.
- Live sync with an open Atlas tab is out of scope. The builder decides how to avoid a silent clobber when both are
  open, and states the choice.

## Code to keep from old Tabletop

Before the rewrite, tag the current state, for example `shelved/overlay`, at commit `63ba889` or later. Existing tags:
`before-3d-table`. Keep and reuse:
- `src/figure.ts` (the mini motion; its feel must not change)
- `src/library.ts`, `src/glbCheck.ts`, `src/gallery.ts`, `src/assignments.ts`
- `src/playerMinis.ts` (Connect's player painter)
- the public API in `main.ts`
- the harness approach (`harness/`, Playwright with swiftshader) and the deploy script

Remove the overlay, the 3D table, the token-menu hook (`overlay.ts`, `table.ts`, `contextMenu.ts`) and the
`toggle-3d-table` / `reset-3d-table` commands. `atlas.ts` keeps only what's still used.

## Left to the builder

The ways to open the 3D tab (suggested: a command, plus "Open in 3D" on a
`.atlasmap` in the file menu), lighting, shadows, the frame and floor, how props are first placed from the gallery,
prop rotation controls, and rendering only on demand. Testing follows Tabletop's pattern: unit tests for pure
logic, plus a browser harness.
