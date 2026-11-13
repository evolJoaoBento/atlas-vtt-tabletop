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

- **One host per map.** When a board opens map M, Tabletop makes sure an Atlas view holds M, loaded (`mapLoaded`, not `isMapLoading`). It uses, in this order:
  1. an Atlas view already showing M;
  2. an Atlas tab of M that is not active (`tabMetaStore` + `switchToTab`), only when that view shows no other map the user is looking at;
  3. a deferred Atlas leaf of M (`loadIfDeferred`, as `BoardView.openInAtlas` does now);
  4. a new Atlas leaf opened in the background (`getLeaf('tab')`, `active: false`), with the board kept in front.
- **Several boards.** Each board map gets its own host. Two boards on one map share one host. A host Tabletop opened is closed by Tabletop when the last board on that map closes. A host the user opened is never closed by Tabletop.
- **The user closes a host.** The board turns read-only and shows a bar: "Atlas closed this map. Editing is paused. [Reopen]". Reopen runs the host steps again. Edits made while the host was loading are queued, in order, and applied once it loads. Nothing is ever written to the file directly.
- **Writes.** Every edit goes through store actions, with a confirmed action per kind:
  - tokens, initiative, doors, walls, notes, lighting
  - measures, liquids, map features
  - levels and level alignment
  The board's file-path engines are deleted: `initiative.ts`'s apply path and `fileCannotRun`, `tokenEdits.ts`, `resources.ts`, the write side of `fog.ts` and `levels.ts`, and `TokenWriter`'s file branch.
- **Reads.** The board renders from the host's store and subscribes to it. It reads the `.atlasmap` file only to draw while the host is still loading, and only for display.
- **Memory.** A background Atlas leaf loads Atlas's 2D canvas for that map.
  - **Budget:** with 3 boards open on 3 maps, the hosts together add at most 300 MB. Measure this in Phase 1.
  - If the budget is exceeded, hosts beyond the first two are suspended (closed and reopened on focus), and their boards are read-only meanwhile.
  - The board test harness runs with a fake store host. It must not open real Atlas leaves.
- **Failure.** If Atlas is missing, older than 0.15, or the host fails to load within 15 s, the board opens read-only with the reason shown. Connect behaves the same way.

### 4.2 Shared Atlas logic: one vendored copy of stock 0.15

- **One package** for both repos, `atlas-shared`. It holds selected files of stock Atlas 0.15 `src/app`, taken verbatim at a pinned tag by a sync script with a file list. This is the same approach as Tabletop's `npm run sync:atlas`.
  - Stock has no `src/shared` entry point, so the bundle is our own index over stock files.
  - Licence: both plugins are AGPL-3.0-only, the same as Atlas, so this is allowed. Keep Atlas's headers and credit the tag in `SOURCE.json`.
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
| 3D wall, door and light extras in data.json | extra fields on Atlas wall and light records if gate G1 passes; else keep, keyed by id with endpoint re-key | 4 |

## 5. Atlas 0.15 floor and plugin pairing

- **Version check.** Obsidian cannot enforce one plugin's version on another. So each plugin reads `app.plugins.manifests['atlas-vtt'].version` at load and whenever Atlas reloads.
  - Below 0.15.0, the plugin loads in a disabled state: one notice, "Tabletop needs Atlas VTT 0.15 or later (found X)", and no board or connection.
  - READMEs, manifests' descriptions and `ATLAS_CHECKED_VERSION` say 0.15.0.
- **Plugin pairing.**
  - Connect's board contract gets a `fusion` protocol number. Tabletop sends its number when it attaches; Connect refuses a mismatch with a notice naming both versions.
  - The web player page carries the same number. A stale hosted page is refused with "This table needs the updated player page". Its hosting is still unknown (open item).
- **Contract file.** Tabletop's `connectContract.ts` stops being a hand copy. It is generated from Connect's `boardTypes.ts` by a script in Tabletop, and a check fails if they differ (audit #6).

## 6. Data migrations: backed up, one-way, reported

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

**Phase 1: Breaks, floor and host**
- version floor and pairing (section 5)
- the Atlas host and the read-only board (section 4.1), measured against the memory budget
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
| Two fog replays (audit #18) | Atlas's fog result is a private canvas. 3D needs exact polygons; Connect's privacy filter needs a fail-closed raster. | One shared stroke reader feeds both |
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

## 11. Gates: facts to verify live, each with a fallback

The user's approval covers both branches of each gate.

| Gate | Check (on Atlas 0.15.0, in a throwaway vault) | If it passes | If it fails |
|---|---|---|---|
| G1 extra fields | A measure, a wall and a light with an extra `tabletop` field survive `addMeasure` / `addWall` → Atlas save → reload of the file → `_8t` reader | 3D extras live on Atlas records | Measures: Atlas's 6 effects + plain (section 7). Walls and lights: keep data.json keyed by id, plus endpoint re-key. Water motion goes on `flow` / `course`. |
| G2 map-feature add | A store action that adds an `objects.mapFeatures` polygon with `terrain.difficult` | Difficult spells write it | The spell's difficult area becomes a measure with `tabletop.difficult` that only Tabletop's ruler counts. It is a documented gap: Atlas's ruler does not count it. |
| G3 lighting write | The store action Atlas's lighting page uses for `ambient` / `ambientColor` | The slider writes it | The slider is removed from the board, and "Lighting in Atlas" opens Atlas's page |
| G4 distance display | The `settingsService` getter for "dragged token shows its distance" | Both rulers obey it | Always show the distance (today's behaviour) |
| G5 party links | Whether Atlas stores which player controls which token | Connect reads Atlas's | Keep Connect's |
| G6 background host | A background Atlas leaf, never shown, stays loaded and saves | Section 4.1 as written | The host is opened as a split pane beside the board (visible, can be collapsed) |
| G7 memory | 3 hosts ≤ 300 MB together | As written | Suspend hosts beyond 2 (section 4.1) |

## 12. My calls, for the user to check

1. The Atlas host lands in Phase 1, not later.
2. The board is **read-only** without an Atlas host. There is no file fallback.
3. A player's template is a temporary measure, one per player, removed when they leave. Casts last until cleared.
4. Measures are not cleared at session end.
5. Stack member files stay on disk after migration. They are not deleted.
6. The memory budget is 300 MB for 3 hosts, with suspension beyond 2.
7. The scene tab bar prefers driving Atlas's own tab strip, if that works live. Otherwise it rebuilds the 0.15 markup.

## 13. Left to the builder

- Exact file list of `atlas-shared` beyond the files named here, and its build wiring in each repo.
- Marching-squares resolution for water polygons.
- Wording of notices, except the version and pairing notices given above.
- How the read-only bar looks (follow the board's existing notice bar).
- Whether `connectContract.ts` generation runs as a pre-build step or a test.

## Open items outside this design

- Hosting of the web join page (`dist-page`), needed for the pairing number to reach players.
- Upgrading the main and promo vaults to Atlas 0.15. This is the user's decision, after Phase 1's live check.
