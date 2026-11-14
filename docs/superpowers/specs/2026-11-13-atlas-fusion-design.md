# Atlas fusion: Atlas is the source of truth (Tabletop and Connect, Atlas VTT 0.15)

Status: draft for the user's approval, 2026-11-13. Covers two repos:
- Tabletop: `atlas-vtt-tabletop`, branch `feat/atlas-fusion` (off `feat/sounds-and-cutscenes`).
- Connect: `atlas-vtt-connect-cutscenes-wt`, a `feat/atlas-fusion` branch off `feat/cutscenes`, made when the first plan begins.

Sources:
- `sound-downloads/redundancy-audit.md` (43 rows; cited as "audit #N")
- `sound-downloads/atlas-0.15-compat.md` (cited as "compat §X")
- the stock Atlas source at tag `0.15.0` (`github.com/atlas-vtt/atlas-vtt`)

## 1. Intent

The user's rule: **"Atlas is source of truth. I don't want redundancy."** Wherever Tabletop or Connect overlap Atlas, the two are fused:
- Atlas's records hold the data.
- Atlas's rules decide the results.
- Atlas's settings are the settings.

The plugins keep only what Atlas does not have: 3D, physics dice, minis, props, sounds, cutscenes, AR, and Connect's self-hosted transport.

Why now: Atlas 0.15 added kept measurements, spell areas, auras, token height, movement steps, a fourth diagonal rule and rooms as walls. Each of these duplicates or contradicts something the plugins already do. Players today see different numbers and different spell areas depending on whose screen they look at.

**Success looks like this:**
- One spell area, one distance, one floor, one light level and one laser colour.
- They are the same in Atlas, on the 3D board, and for Connect players, whether those players use the 2D page or the 3D board.
- Nothing either plugin stores repeats something Atlas stores.

## 2. Goals, non-goals and anti-goals

**Goals**
- Remove every redundant row of the audit (b, c and d), or record why it cannot be removed (section 9).
- Both plugins require Atlas 0.15.0 or later.
- Atlas features new in 0.15 show up in 3D and for Connect players:
  - measures, effects, auras, and light and darkness from measures
  - token height
  - movement steps
  - custom unit names

**Non-goals**
- Replacing Atlas Online, or changing Connect's no-account model (audit #40).
- Turning 3D-only data into Atlas features. Wall heights, materials and minis stay Tabletop's (audit #33, #34).
- Supporting Atlas 0.14 or older.

**Anti-goals** (a failure even if it technically works):
- **A second store kept "just in case".** A file-path fallback that edits `.atlasmap` itself when no Atlas view is open is exactly the redundancy being removed. The board must not keep one (section 4.1).
- **Silent data loss on upgrade.** Wall overrides, stacks and spells already saved must survive, or be backed up and reported.
- **Plugins disagreeing during the transition.** Tabletop and Connect ship each phase together. A mismatched pair refuses to connect, with a message, and never shows wrong data.

## 3. Decisions

From the user (2026-11-13):
1. **Require Atlas 0.15 for both plugins.**
2. **Spell looks.** Tabletop's 14 damage types are stored as an extra field on Atlas's measure record. If Atlas drops extra fields, fall back to Atlas's 6 effects plus a plain look.
3. **Map stacks to Atlas levels.** A one-way migration, with a backup taken first.
4. **Order.** Breaks and quick wins first, then shared Atlas logic, then spells and measures, then levels, sight, water, initiative and dice. Each step ends with a live check on Atlas 0.15.

My calls (the user can override any of them; listed again in section 12):
- The Atlas host (section 4.1) lands in **Phase 1**. The ambient fix and every later phase need it.
- Without a loaded Atlas view the board is **read-only**. It never falls back to writing files.
- The shared logic bundle starts in Phase 1 with one file, Atlas's `gridDistance.ts`, so the Manhattan fix is Atlas's own code from day one.

## 4. Architecture

### 4.1 Atlas host: every write goes through Atlas's store

Stock Atlas has no API (audit, "Root finding"). Its rules and saving live in the store of a loaded Atlas view. So:

- **One host, the single Atlas view.** Phase 0 found that stock Atlas 0.15 keeps only one Atlas leaf, and that leaf holds one map at a time. On every layout change Atlas closes extra Atlas leaves and reopens their maps as internal tabs of the one left. So there is exactly one host.
  - **Map M is "held"** when the host's store has `mapPath === M`, is loaded, and is not loading.
- **The host follows the focused board (user's choice, 2026-11-13).** When a board gains focus, or opens, the host is made to hold its map:
  1. If the host already holds it, nothing happens.
  2. If the host has an internal tab of M, use `switchToTab`.
  3. If there is a deferred Atlas leaf, use `loadIfDeferred`. Otherwise open a new background leaf. Phase 0's G6 recipe: after `getLeaf('tab')`, make the board's leaf active again **before** `setViewState`. Without that, Atlas takes the front.

  The board stays in front throughout. A host that Tabletop opened is closed when the last board closes; one that the user opened never is.
- **Boards on other maps** are view-only until they gain focus. They show a bar: "View only. Atlas holds <map>. [Edit here]". The button focuses the board, which moves the host.
- **Player edits on a map that is not held** are refused at the GM. Connect tells the player: "The GM's Atlas is on another map; try again in a moment." They are never queued and never written to a file. Players are normally on the GM's map, so this is rare.
- **Connect** asks the same host. Connect never moves the host itself: only a board's focus, or the user in Atlas, does.
- **The user closes a host.** The board turns read-only and shows a bar: "Atlas closed this map. Editing is paused. [Reopen]". Reopen runs the host steps again. Edits made while the host was loading are queued, in order, and applied once it loads. Nothing is ever written to the file directly.
- **Writes.** Every edit goes through store actions, with a confirmed action per kind:
  - tokens, initiative, doors, walls, notes, lighting
  - measures, liquids, map features
  - levels and level alignment
  The board's file-path engines are deleted: `initiative.ts`'s apply path and `fileCannotRun`, `tokenEdits.ts`, `resources.ts`, the write side of `fog.ts` and `levels.ts`, and `TokenWriter`'s file branch.
- **Reads.** The board renders from the host's store and subscribes to it. It reads the `.atlasmap` file only to draw while the host is still loading, and only for display.
- **Memory.** Phase 0 measured the cost. The first Atlas load adds about 270 MB, about 100 MB of which is an audio process. Each further map adds about 20 MB.
  - Closing Atlas frees little, about 57 MB. So Tabletop never closes and reopens the host to save memory. It keeps the host open while any board is open.
  - The board test harness runs with a fake store host. It must not open real Atlas leaves.
- **Failure.** If Atlas is missing, older than 0.15, or the host fails to load within 15 s, the board opens read-only with the reason shown. Connect behaves the same way.
- **A missing store action.** If Phase 0 finds no store action for some kind of edit (gate G8), that edit is not offered on the board. An "Edit in Atlas" button opens the host in front instead. A file write is never the fallback.
- **Connect has its own host and does not need Tabletop.** A GM can run Connect with no Tabletop board open. Host code is the same in both plugins.
  - **Where it lives:** an Obsidian-side module, `atlas-host`, separate from the browser-safe `atlas-shared`. It grows out of Connect's `stockWake.ts`.
  - **How it is shared:** it is shared the way `atlas-shared` is (section 4.2).
  - **Both plugins on one map:** they share one host leaf. Each finds an existing view first.

### 4.2 Shared Atlas logic: one vendored copy of stock 0.15

- **One package** for both repos, `atlas-shared`. It holds selected files of stock Atlas 0.15 `src/app`, taken verbatim at a pinned tag by a sync script with a file list. This is the same approach as Tabletop's `npm run sync:atlas`.
  - Stock has no `src/shared` entry point, so the bundle is our own index over stock files.
  - Licence: both plugins are AGPL-3.0-only, the same as Atlas, so this is allowed. Keep Atlas's headers and credit the tag in `SOURCE.json`.
- **Where it lives.** It lives in the Connect repo as `packages/atlas-shared/`, with `SOURCE.json` naming the Atlas tag. `atlas-host` lives at `packages/atlas-host/`.
  - Tabletop copies both in with a sync script. This is the way Connect already vendors Tabletop's player board.
  - Tabletop's copy carries the same `SOURCE.json`, and a check fails when the two differ.
  - There is no third repo and no npm publishing.
- **Browser-safe.** No Obsidian, Node or DOM imports, because Connect's web player page uses it too. The sync script fails on a disallowed import.
- **It replaces** Tabletop's `measure.ts` rule code, `geometry.ts` `snapPoint`, `gridLines`/`cellNumbers` rules, `levels.ts` and `walls.ts` readers, `atlasPort/app/{grid,levels,lighting,vision}`, the pin and condition icon data, `rollRules.ts`, and the resource readers. In Connect it replaces `vendor/atlas/shared/*` (the shelved fork, API 1.18.0), `stockRules` distance, `initiativeSides.ts`, `stockLevels.ts`, `stockTokens/ported/*`, `view/pinIcons.ts`, and `physicalRolls.ts`'s judge.
- **Upgrading Atlas** means bumping the tag, running the sync, and running both test suites. A checker fails CI when the shared tag and the plugins' minimum Atlas version differ.
- **Settled fact: Manhattan.** Stock `src/app/grid/gridDistance.ts` `cellsByRule` gives `straight + 2*diagonal + climb`. Height counts as a third axis under every rule. The audit's formula is confirmed. The compat report's "not decoded" is superseded.

### 4.3 Atlas records are the only store

| Today (duplicate) | Becomes | Phase |
|---|---|---|
| `MapData.ambient` / `tint` | `state.lighting.ambient` / `ambientColor` via the store | 1 |
| `settings.laser` | `settingsService` laser settings | 1 |
| Tabletop dice volume | Atlas `dice.volume` | 1 |
| Wall overrides keyed by old room ids | re-keyed by endpoints (section 6) | 1 |
| Tabletop spells, Connect templates and spells | `objects.measures` (+ Atlas walls, lights, map features) | 3 |
| Map stacks (`MapData.layer` / `hidden`) | Atlas `state.levels` of the base scene | 4 |
| Tabletop water mask | `objects.liquids` | 4 |
| `lineOfSight` / `sightStyle` settings | Atlas `state.lighting.enabled` + `playerSight()` | 4 |
| Dice colour list, die look | Atlas `getDiceLook()` + dice set colours | 4 |
| 3D wall, door and light extras in data.json | a `tabletop` field on Atlas's wall, light and token records (done in 4A: G1w, G1l and a probe of tokens passed) | 4 |

## 5. Atlas 0.15 floor and plugin pairing

- **Version check.** Obsidian cannot enforce one plugin's version on another. So each plugin reads `app.plugins.manifests['atlas-vtt'].version` at load and whenever Atlas reloads.
  - Below 0.15.0, the plugin loads in a disabled state: one notice, "Tabletop needs Atlas VTT 0.15 or later (found X)", and no board or connection.
  - READMEs, manifests' descriptions and `ATLAS_CHECKED_VERSION` say 0.15.0.
- **Plugin pairing.**
  - Connect's board contract gets a `fusion` protocol number. Tabletop sends its number when it attaches; Connect refuses a mismatch with a notice naming both versions.
  - The web player page carries the same number. A stale hosted page is refused with "This table needs the updated player page".
  - A page from before fusion sends no number at all, so it is refused too. The anti-goal therefore holds whoever hosts the page.
  - A phase is done once the page is built. Deploying it is the open item.
- **Contract file.** Tabletop's `connectContract.ts` stops being a hand copy. It is generated from Connect's `boardTypes.ts` by a script in Tabletop, and a check fails if they differ (audit #6).

## 6. Data migrations: backed up, one-way, reported

Triggers:
- **Migration 1 runs on its own.** It runs whenever a host loads a scene whose walls hold the new `room_<level>_` ids next to old overrides. That is exactly when Atlas 0.15 has converted the scene, so it needs no sweep.
- **Migration 3 asks first.** On the first start after Phase 4, the GM is asked: "Move N map stacks to Atlas levels? A backup is made first. [Move] [Later]". The question comes back each start until they choose Move. It also lives in a command.
  - It walks the stacks one base scene at a time. For each base scene it opens a host, writes through the store, saves and closes.
  - It re-points cutscene shots across all board data.
  - Without a host for a scene, that scene is skipped and listed in the summary, never written as a file.

All migrations follow the same rules:
- They run once per map.
- They write a backup first, to `Tabletop backups/<date>/` in the vault: the `.atlasmap` and the plugin data that will change.
- They log a summary notice: "Moved 3 stacks to levels; backup in …".
- A migration never deletes the backup.

1. **Room-wall overrides (Phase 1, before any real vault opens a scene in 0.15).**
   - When a scene holds walls with ids `room_<level>_x1_y1_x2_y2`, and data.json has overrides for `room_x1_y1_x2_y2` with the same endpoints, the overrides move to the new id. This covers height, width, material and window.
   - Guard: skip the computed room outline when the walls already hold `room_` ids with a `rooms_` chain (compat item 3).
   - Then delete Connect's rooms port. Tabletop keeps a read of `objects.rooms` only for 0.14 files that Atlas 0.15 has not saved yet.
2. **Spells to measures (Phase 3).** Spells live in the board session, not in files, so none are saved to migrate. Lasting spells on boards that are open at upgrade are not carried over. Nothing is lost on disk.
   **3D extras onto records (Phase 4A).** What data.json kept by Atlas's ids (wall and door heights, widths, materials, window openings, door props and flips, light heights) goes onto the record of that id, in its `tabletop` field. It loses nothing Atlas still has a record for, so it runs on its own like migration 1, once per map, when Atlas holds the map, after the backup; a value whose record is gone stays in the backup only.
3. **Stacks to levels (Phase 4).** Each stack member becomes a level of the base scene:
   - `elevation.bottom = layer.elevation × unitDistance`
   - the member's background, its tokens, walls, lights, pins, drawings, texts and fog, tagged with the new level id
   - `x/y/turn` baked into `levelAlignments`
   - per-wall overrides re-keyed to the copied walls
   - cutscene shots on a member map re-pointed to the base scene plus the level id (section 7)

   The member files stay on disk, untouched, with a note in the summary. The board then reads levels only. The stack UI, `BoardLayerRecord` and `tokensMoved` are deleted.

## 7. Intersections with what just shipped

- **Cutscenes.**
  - A shot gains an optional `level` (the level the camera looks at). Shots on migrated stack members are re-pointed by migration 3.
  - Cross-map steps stay cross-map between scenes. Level changes within a scene become a level switch on the same map, which allows a move transition.
  - Connect's contract keeps run-local map keys, and adds a level.
- **Spell sounds.**
  - All 14 damage types keep their own impact and loop sounds while extra fields survive (gate G1).
  - Under the fallback, a measure carries only Atlas's effect, mapped as follows:
    - fire → fire
    - frost → cold
    - lightning → lightning
    - radiance → radiant
    - shadow → necrotic
    - mist → plain
  - In that case acid, bludgeoning, explosion, force, piercing, poison, psychic, slashing and thunder are unreachable. They play the plain impact and loop, and the silent-while-standing rule for weapon types stops mattering.
  - An area made in Atlas with an effect plays its mapped sound in 3D.
- **Board sounds.** The dice group follows `dice.volume`. All other groups stay Tabletop's.

## 8. Phases

Each phase:
- gets its own plan and SDD run;
- ships Tabletop and Connect together with the same `fusion` number;
- ends with a live check in a **throwaway copy** of the vault on Atlas 0.15.0, using the compat report's live-check steps for that phase.

Upgrading the main and promo vaults is the user's decision, not part of any phase.

Live checks:
- Scripted where possible. Obsidian is driven over the DevTools protocol in the throwaway vault, as the 0.14 live check was.
- Anything needing a device or ears is listed for the user: AR, listening.

**Phase 0: Gate spike (no product code)**

Every gate in section 11 is checked first, in a throwaway vault on Atlas 0.15.0, by a script. Results go into this document's gate table, and only then are the phase plans written. A failed gate picks its fallback before planning, so no phase is planned for both branches.

**Phase 1: Breaks, floor and host**
- version floor and pairing (section 5)
- the single Atlas host that follows the focused board, the view-only bar for boards on other maps, and refusal of player edits on maps that are not held (section 4.1)
- fix the error Tabletop's ported asset manager logs on Atlas 0.15: "[Atlas] Initializing asset service failed: TypeError: te.initialize is not a function"
- `atlas-shared` with `gridDistance.ts`: Manhattan and height in both plugins' distances
- custom unit names (`unitName`, `unitNameOverride`), both plugins
- room-wall re-key and doubled-wall guard; delete Connect's rooms port
- scene tab bar in 0.15 markup (`__label`, `__action--start` / `--end`, `--presented`), or, better, driven from Atlas's own tab strip when an Atlas leaf sits beside the board
- ambient and tint via the store; laser via `settingsService`; dice volume from Atlas
- pin `showName` (already done in 825c362; verify only)

**Phase 2: Shared logic**
- fill `atlas-shared`:
  - distance, cost and movement (`measure/*`: `dragDistance`, `movementRules`, `tokenHeight`)
  - snapping, cell numbering, grid lines
  - scene levels, walls and lighting constants
  - icons, the dice judge, resources and initiative sides
  - the fog stroke reader
- switch both plugins to it and delete their copies
- token `elevation`: lifts the figure by `elevation / unitDistance` squares, counts in rulers and hit tests, and is sent in Connect's token projection
- token `speed` and the collection's `movement` steps colour the drag ruler on both plugins. The distance-display setting is read from Atlas (gate G4).
- delete the file-path engines now that the host is mandatory: initiative apply, token edits, resources

**Phase 3: Spells and measures**
- `objects.measures` is the only store for areas, templates, spells and auras.
  - The GM's board writes with `addMeasure` / `updateMeasure` / `deleteMeasure`.
  - Players' casts and templates reach the GM through Connect. The GM's Connect writes them with `by: <player>`.
  - The GM's cast review stays as it is.
- Shapes:
  - sphere and cylinder → `circle`
  - cube → `square`
  - cone → `cone`
  - line or beam → `line` with `width`
  - wall spell → `line` measure plus real Atlas walls
- Extra fields: `tabletop: { damage, h, pitch, yaw, roll, shape3d }`, under gate G1.
- Spell rules become Atlas records:
  - walls → `addWall`, chained by spell id, deleted with the spell
  - light and dark → the measure's `light` (`darkness: true`)
  - difficult → an `objects.mapFeatures` difficult-terrain polygon (gate G2)
  `spellRules.ts` keeps only push, teleport, portal and summon, which move tokens through the store.
- Lifetime: measures are saved in the map like Atlas's.
  - The GM's "Clear spells" (toolbar) and Atlas's "clear measures" remove them.
  - A session end does not clear them.
  - A player's own template, unlike a cast, is a temporary measure. It is removed when that player leaves, or when they place a new template (one per player).
- Limits:
  - Connect enforces 10 per player and 40 per scene at the GM, before writing.
  - Atlas's cap of 256 per shown level is checked before writing. When the cap is reached, the player gets a refusal message.
- Projection to players stays allowlist-based. Send `objects.measures` with `hidden !== true` and the player's level, and strip `origin`. Players draw them on the 2D page and the 3D board alike.
- Delete Connect's `TemplateHost`, its spell storage and the `map-template` / `map-spell` messages, Tabletop's `overlay().templates` and session spells, and Tabletop's `playerTools` template copy (audit #27).
- Effects and sounds key off the measure (section 7). An Atlas area made in Atlas shows in 3D.
- 3D hit tests use Atlas's `areaCellRule` and `coneEnd` from the shared bundle.

**Phase 4: Levels, sight, water, initiative, dice and ported UI**
- Stacks to levels (migration 3). Delete the stack UI and protocol.
- Sight follows Atlas.
  - Delete `lineOfSight` and `sightStyle`.
  - When the scene's lighting is on, the board draws Atlas's `playerSight()` from the host, as Connect does, moved into one shared module.
  - The room-shaped veil may remain as a way of drawing that answer.
  - Measure light and darkness come through Atlas.
- Water:
  - The board renders `objects.liquids` (water, lava, acid, using Atlas `colors`).
  - Tabletop's brush writes polygons with `addLiquids`, using marching squares over the brush mask.
  - Motion settings ride as extra fields (gate G1), or else on `flow` / `course`.
  - Delete the data.json mask and `BoardExtras.water`.
- Initiative: the board panel is re-synced from 0.15 source by `sync:atlas`. Its writes are store actions only (done in Phase 2).
- Dice:
  - The die colour, skin and numerals come from `getDiceLook()` and the dice set group colours.
  - Tabletop keeps only its physics settings and 3D pack.
- Ported UI: palette, asset manager, random tables and loot are re-synced from 0.15. The asset manager is replaced by Atlas's own global manager if a spawn path onto the board can be made (drag or a "place on board" picker). Otherwise the port is re-synced.
- 3D wall, door and light extras move onto Atlas records if G1 passes for walls and lights. Otherwise they stay keyed by id with the endpoint re-key from migration 1.
- Sheets: one shared sheet model and `resolveLinkedCreature` from the shared package. Display stays Atlas's card.
- Connect `BoardExtras.lighting`, `ambient` and `tint` are deleted; players read the projection.

## 9. What stays duplicated, and why

| Item | Why it cannot go | What keeps it honest |
|---|---|---|
| Ported command palette, initiative tracker panel, loot and random tables, maybe the asset manager (audit #9, #21-23) | Atlas's components live inside the Atlas view's React tree and are not exported. Its commands act on Atlas's own view, not the board. | Re-synced from the pinned tag by `sync:atlas`; parity checker against the installed Atlas |
| Two fog replays (audit #18) | Atlas's fog result is a private canvas. 3D needs exact polygons; Connect's privacy filter needs a fail-closed raster. Each needs `clipper2-ts` or a raster of its own, so a shared stroke reader is not worth a package import (Phase 2) | Both read Atlas's stored fog operations; each has its own tests |
| The dice judge of a physical throw | Atlas has no function that scores dice that already landed: its roller rolls its own | Since Phase 2 it decides critical results (`getDiceCrit`) and exploding faces (`explodingFaces`, `MAX_EXPLOSIONS`) with Atlas's own code from `atlas-shared`; only the scoring of landed dice is Tabletop's |
| Connect's older shared bundle (`vendor/atlas`: `draw`, `dice3d`, `diceDisplay`, the API types) | They draw (pixi, three) and are no rules; the dice look is Phase 4 | Rules moved to `atlas-shared` in Phase 2; what is left only draws |
| Tabletop's `src/atlasPort/app/{grid,levels,lighting,vision}` | Pulled in by the ported panels (palette, tracker, loot, asset manager) | Go when the panels are re-synced in Phase 4; the board's own rules read `atlas-shared` |
| A 3D spell's own hit test (Phase 3) | A sphere over the floor or a cone tilted up has a height, and Atlas's areas have none. Atlas's `areaCellRule` applies to flat areas only | The spell is read back from its measure (`measureToSpell`), so both start from the same two points |
| The board works a spell's walls, light and difficult ground out from the spell (Phase 3) | Players' boards have no Atlas store, and their scene carries no map features or measure lights; walls read back from Atlas would be built and painted as the map's own. The records Atlas holds for a spell are for Atlas (2D view, sight, movement rules) | One function shapes both (`spellRuleWalls` / `derivedRecords`); a reconciler keeps Atlas's records in step with the measure; the board filters them out of the map's walls |
| The shared bundle itself | Atlas exposes no API, so its rules are vendored | Verbatim stock files at the same tag as the minimum version |
| Connect's per-token "Players see" (audit #29) | It extends Atlas's collection-level setting rather than repeating it | Defaults to Atlas's value |
| Party links (audit #28) | Unknown whether Atlas stores a token-player link (gate G5) | Kept until G5 answers; fused if Atlas has one |

## 10. What users lose

- **Editing without Atlas.** The board edits only while an Atlas host holds the map. Without one it is read-only.
- **Tabletop's own sight setting.** Sight follows the scene's dynamic lighting. With lighting off, no sight is drawn on the GM's board.
- **Per-map 3D ambient and tint different from Atlas's.** One light level everywhere.
- **Water detail.** Painted water becomes polygons, so brush-level edges are lost.
- **Stack placement.** `x/y/turn` becomes Atlas's level alignment; a rotated stack member may sit slightly differently.
- **Spell heights.** A sphere or cube's height has no Atlas meaning, and Atlas and 2D players see a flat area. 3D keeps the height only while G1 holds.
- **Tabletop's dice colour list.** The die looks like Atlas's dice.
- **Lasting spells on open boards at the moment of upgrade** are not carried over (they were never saved).
- **Setting a wall, a door or a light in 3D without Atlas on the map (Phase 4A).** Heights, widths, materials, window openings, door props and light heights are on Atlas's records, so setting one needs Atlas to hold that map; it used to be kept in Tabletop's data whatever Atlas held.
- **Casting without Atlas on the map (Phase 3).** A cast or a template needs Atlas to hold that map. On a split party's other scene, or with Atlas on another map, it is refused and the player is told; nothing is written.
- **Several templates per player.** A player has one template at a time; placing another takes the place of the last. Templates go when their player leaves and when a session starts or ends. The GM's own stay until removed.
- **Fresh casts on reopening.** Kept spells are in the map: opening a board shows them standing, with no cast sound, and carries out no push, teleport or summons again.
- **Template shapes.** A square grows from the middle of its near side and a line is one cell wide, as Atlas shapes them; templates snap as Atlas's areas do.
- **The GM's colour on the GM's own spells and templates.** They carry no colour: Atlas draws them in its accent.
- **A spell's light where Atlas has none.** A darkness is Atlas's on a round area only; on a cube or a cone it is the 3D board's alone. A spell's light takes the area's colour in Atlas when the area has one (a player's).
- **An aura's exact reach.** A measure that follows a token (Atlas 0.15's auras, and a spell the GM makes follow its caster) is drawn around its token as large as it was last made in Atlas; it is not worked out again from its reach when the token's size changes.
- **The sound of an area made in Atlas.** An area with an effect (fire, frost) kept in Atlas is drawn flat on the board and plays no loop there; only spells sound.
- **A stretched wall or column grows taller.** A spell's sizes ride on its measure's two points, so one resized in Atlas scales whole, its height included.

## 11. Gates: facts to verify live, each with a fallback

The user's approval covers both branches of each gate.

| Gate | Check (on Atlas 0.15.0, in a throwaway vault) | If it passes | If it fails |
|---|---|---|---|
| G1 extra fields | Checked **separately for each record type**: G1m measures, G1w walls, G1l lights, G1q liquids. A record with an extra `tabletop` field survives the store's add action → Atlas save → reload of the file → the reader. | That type keeps its 3D extras on the Atlas record. For G1m, all 14 damage types keep their sounds whatever the others give. | G1m: Atlas's 6 effects + plain (section 7). G1w and G1l: keep data.json keyed by id, plus the endpoint re-key. G1q: water motion goes on `flow` / `course`. |
| G2 map-feature add | A store action that adds an `objects.mapFeatures` polygon with `terrain.difficult` | Difficult spells write it | The spell's difficult area becomes a measure with `tabletop.difficult` that only Tabletop's ruler counts. It is a documented gap: Atlas's ruler does not count it. |
| G3 lighting write | The store action Atlas's lighting page uses for `ambient` / `ambientColor` | The slider writes it | The slider is removed from the board, and "Lighting in Atlas" opens Atlas's page |
| G4 distance display | The `settingsService` getter for "dragged token shows its distance" | Both rulers obey it | Always show the distance (today's behaviour) |
| G5 party links | Whether Atlas stores which player controls which token | Connect reads Atlas's | Keep Connect's |
| G6 background host | A background Atlas leaf, never shown, stays loaded and saves | Section 4.1 as written | The host is opened as a split pane beside the board (visible, can be collapsed) |
| G7 memory | 3 hosts ≤ 300 MB together | As written | Suspend hosts beyond 2 (section 4.1) |

**Phase 0 results (2026-11-13, stock Atlas 0.15.0; full report `.superpowers/sdd/2026-11-13-atlas-fusion/phase0-report.md`):**

| Gate | Result | What follows |
|---|---|---|
| G1m, G1w, G1l, G1q | **PASS** for all four | A `tabletop` field survives the add, the save, a reopen, a full restart and a later save. So 3D extras live on Atlas records: measures keep all 14 damage types, and walls, lights and water motion move off data.json. |
| G2 | **PASS** | `addMapFeatures` with `terrain.difficult` |
| G3 | **PASS** | `setSceneLighting({ambient, ambientColor})` |
| G4 | **PASS** | `settingsService.getDragDistance()` / `setDragDistance` (`always` / `combat` / `never`) |
| G5 | **PASS** (from the source; not live, since there was no campaign) | `players.json`: `characters`, `tokenOwners`, `playerTokens[mapPath]`. Not fused in Phase 2: reading it cannot be checked without a vault with an Atlas Online campaign, so Connect keeps its party links until one is at hand. |
| G6 | **PASS for one host only** | Atlas keeps a single Atlas leaf. Section 4.1 was rewritten around one host that follows the focused board. |
| G7 | **N/A** (there can be only one host) | About 270 MB for the first load, about 20 MB per further map. Closing frees little. |
| G8 | **PASS** | Every write has an action and saves through Atlas's autosave in 0.5 to 1 s. Some writes take two steps: |

**Phase 3 probe (2026-11-13, stock Atlas 0.15.0; `harness/live/phase3-probe.cjs`, results `.superpowers/sdd/2026-11-13-atlas-fusion/phase3-probe.json`):**

| Gate | Result | What follows |
|---|---|---|
| G9 a measure with a nested `tabletop` object of 4 KB, `by`, `hidden`, a level | **PASS** | Kept in the store, in the file after the save, and after switching map and back. A spell's 3D extras live in the measure. |
| G10 one undo step for a cast | **PASS** | `store.temporal.getState().transaction(fn)`: every write of `fn` is one step. A cast is one step: its measure. |
| G11 writes that are no undo step | **PASS** | `temporal.getState().untracked(fn)`: 0 steps. What a spell stands in Atlas (walls, difficult ground, light) is derived from its measure outside the history. |
| G12 an area's `light`, and `darkness: true` | **PASS** | Kept as given. Atlas reads a darkness on a circle only (`canBeDarkness`), so only a round spell's darkness is written. |

The G8 writes that take two steps:
- **Levels:** there is no `addLevel`. Use `setLevels` with the whole array, built with Atlas's `levelEdits.ts` helpers, which go into `atlas-shared`. Alignment is `levels[].alignment`.
- **Liquids:** there is no `updateLiquid`. Delete and re-add, which gives a new id, so Tabletop must not key anything on liquid ids.
- **Walls:** there is no delete-by-chain. Filter the walls on `chainId`, then call `deleteWalls`.
- **Moving between levels:** `moveTokensToLevel` covers tokens only. Other objects move with their own update action.
| G8 store actions | Each write the design needs has a store action that saves. Checked: tokens incl. `elevation`; initiative; doors and walls incl. `chainId`; notes; `addMeasure` family; `addLiquids`; levels (add a level, set its background and elevation, `levelAlignments`); moving objects between levels | Written through the store | That edit is not offered on the board; "Edit in Atlas" instead (section 4.1). A level action missing makes migration 3 wait until it is found, and the stacks stay as they are. |

## 12. My calls, for the user to check

1. The Atlas host lands in Phase 1, not later.
2. The board is **read-only** without an Atlas host. There is no file fallback.
3. A player's template is a temporary measure, one per player, removed when they leave. Casts last until cleared.
4. Measures are not cleared at session end.
5. Stack member files stay on disk after migration. They are not deleted.
6. (Superseded by Phase 0.) There is one host, and it is never suspended.
7. The scene tab bar prefers driving Atlas's own tab strip, if that works live. Otherwise it rebuilds the 0.15 markup.
8. Phase 0 checks every gate before any plan is written.
9. Connect gets its own Atlas host and does not need Tabletop. The shared code lives in the Connect repo, under `packages/`, and Tabletop copies it in.
10. Migration 1 runs on its own. Migration 3 asks first, and asks again on each start until the GM says Move.
11. Live checks are scripted over DevTools. Device checks and listening go to you.

## 13. Left to the builder

- Exact file list of `atlas-shared` beyond the files named here, and its build wiring in each repo.
- Marching-squares resolution for water polygons.
- Wording of notices, except the version and pairing notices given above.
- How the read-only bar looks (follow the board's existing notice bar).
- Whether `connectContract.ts` generation runs as a pre-build step or a test.

## Open items outside this design

- Hosting of the web join page (`dist-page`), needed for the pairing number to reach players.
- Upgrading the main and promo vaults to Atlas 0.15. This is the user's decision, after Phase 1's live check.
