# Atlas toolbar parity: random tables (loot), asset manager and command palette on the 3D board

Status: approved — 2026-11-02

## Intent

A GM running a scene on Tabletop's 3D board should not have to go back to Atlas's 2D map to roll loot, pull a token
out of the library or reach a command. Atlas's scene toolbar has those three on it; the 3D board should have them too,
working the way they do in Atlas, on the same data (the same tables, the same library, the same roll history, the same
map file). When Atlas changes or adds a toolbar feature, Tabletop should find out at once and be easy to bring level.

## Decisions made by the user

- **Rebuild in Tabletop.** Tabletop draws the panels itself on the 3D board. It does not send the GM to Atlas's tab to
  use Atlas's own panels.
- **Same behaviour, same data.** "Basically an import of how it works in the normal Atlas scene with the same data."
- **This round: Random tables (loot), Asset manager, Command palette.** The other Atlas toolbar tools (fog, draw,
  text, walls/lighting, note pins, ambient sound) are later rounds, one at a time, in an order the user picks.
- **`Shift+A` opens the asset manager on the board**; the camera keeps W/A/S/D (Atlas's `A` would clash).
- **Future parity must be easy.** Every Atlas toolbar feature is accounted for, and adding one in Atlas must surface in
  Tabletop.

## Goals

1. The board's toolbar gets Atlas's **Random tables** (coin icon, `L`), **Asset manager** (image icon; `Shift+A` on the
   board, by the user's decision, because `A` pans the camera there) and
   **Command palette** (command icon, `Space`) buttons, GM only, in Atlas's order, honouring Atlas's own toolbar
   customisation (a tool the GM hid in Atlas is hidden here).
2. Each opens a panel that looks and behaves like Atlas 0.12.0's, works on the same vault data, and acts on the 3D
   board (a token spawned from the asset manager lands on the board the GM is looking at).
3. A **parity table** in Tabletop lists every Atlas toolbar tool, every command palette entry and every asset manager
   tab, with what Tabletop does for it. `npm run check:atlas` reads them out of the installed Atlas build and fails when
   Atlas has one the table doesn't list (or the table lists one Atlas dropped).

## Non-goals

- Fog, draw, text, walls/lighting tools, note pins, ambient sound on the board (later rounds; listed as "not yet" in the
  parity table).
- Giving loot to a player's book and showing loot in Atlas's player window. Atlas only offers "give" with its online
  table running and draws "show" in its own player window; Tabletop can reach neither. Listed as "not yet".
- Rebuilding Atlas's heavy authoring flows: token creator, encounter builder, create scene from map, dungeon generator,
  collection settings, table import/paste. These do not need the 3D board; they hand off to Atlas (see below).
- Changing Tabletop's existing tools (move/laser, templates, lighting, board settings, dice).

## Anti-goals (would be a failure even if it works)

- **Two writers on Atlas's files.** Tabletop must never construct its own copy of Atlas's asset service, run its
  migrations or index writes, or write Atlas's library files. A second writer over `atlas-vtt/` corrupts the GM's
  library.
- **Overwriting Atlas's roll history.** Atlas writes `loot-history/<deviceId>.json` and ignores changes to it; if
  Tabletop wrote the same file the two would erase each other's rolls.
- **Registering Atlas's things twice:** the `atlas-loot` Bases view type, Atlas's window event
  `create-scene-from-map`, Atlas's command ids.
- **A look that drifts from Atlas.** No hand-written lookalike CSS for these panels.
- **Losing a write.** When Atlas has the map open, map writes go through Atlas's store (Atlas never re-reads an open map
  and would save over a file edit). This is Tabletop's existing rule (`TokenWriter`).
- **Minis or anything new on Connect's web page** (standing rule).

## Constraints

- Atlas has no public API and bundles React; its components cannot be imported or mounted from Tabletop (recon,
  2026-11-02). The only Atlas UI mountable outside its map view is `plugin.globalAssetManager.open(tab)`.
- Atlas's panel CSS is all scoped under `.atlas-vtt-plugin` and ships in Atlas's live `styles.css`, which Obsidian loads
  whenever Atlas is enabled. Tabletop already relies on this for its toolbar (`.atlas-tabletop-atlas`).
- Both plugins are AGPL-3.0; porting Atlas code is allowed with attribution.
- Tabletop house rules: Atlas schemas are taken from Atlas's **built** `main.js`, not its source; no commits;
  checksum-verified deploys; every private Atlas member used goes into `scripts/check-atlas-members.mjs`.
- Target Atlas 0.12.0 (installed in the 2075 vault as of 2026-11-02); keep working, degraded, without Atlas loaded.

## Approach

### The pattern: redraw with Atlas's own markup, use Atlas's live data

Tabletop already mirrors Atlas this way (`sceneTabBar.ts` redraws `SceneTabBar.tsx`, `atlasMenu.ts` redraws
`AtlasContextMenu`). The three panels follow the same pattern:

- **Markup:** plain DOM (as the rest of Tabletop) that reproduces Atlas 0.12.0's element structure and class names
  (`atlas-loot-*`, `atlas-command-*`, `atlas-asset-manager-*`, `btn btn--*`), inside an `.atlas-vtt-plugin` root. Atlas's
  live stylesheet styles them; when Atlas restyles, Tabletop follows with no change.
- **Logic:** Atlas's pure functions (rolling a table, drawing loot, rarity filtering, history shaping, token spawn data
  such as hit-point rolls and vision defaults, formation layout) are ported as TypeScript copies under `src/atlasPort/`,
  as close to verbatim as the absence of React allows. Each ported file starts with a header naming its Atlas source path
  and version (`Atlas source: src/app/…/lootHistory.ts @ 0.12.0`).
- **Data:** read through Atlas's runtime when an Atlas view is loaded (`view.serviceManager.getAssetService()` and
  friends, as `atlasDice.ts` already does), otherwise from the vault files read-only. Never a second asset service.
- **Map writes:** through Atlas's store when Atlas holds the map, else `vault.process`, via `TokenWriter` (extended as
  needed, e.g. a batch `addTokens` and the loot-roller block).
- **Atlas's text:** labels, tooltips and descriptions copied in English from Atlas 0.12.0 (Tabletop's language rules
  apply to anything Tabletop writes itself).

### Random tables (loot)

- A floating, draggable, resizable window over the board, like Atlas's (not an Obsidian modal). Same panes and controls
  as Atlas 0.12.0's `RandomTablesPanel`: table list with on/off, rarity exclusions, count, roll, results cards, history.
- **Tables:** the markdown tables and generators listed in the map's collection settings, and the loot bases. For the
  bases, Tabletop must not register `atlas-loot` itself; it reads them through the view Atlas registered (for example
  by rendering the base embed through Obsidian, as `atlasCardHost.ts` renders Atlas's statblock card). If a base cannot
  be read that way, it is listed with an "open in Atlas" hand-off rather than silently dropped.
- **Choices shared with Atlas:** which tables are on, rarity exclusions, count and selected item live in the map file's
  `lootRoller` block, read and written the same way, so Atlas and the board agree. The window's open state, position and
  size are the board's own (the board's layout differs from Atlas's).
- **History:** Tabletop writes its own file, `atlas-vtt/collections/<c>/loot-history/<deviceId>-tabletop.json`, in
  Atlas's shape (`{format:1, rolls, removed?}`, newest first, at most 100), and shows the merged history of every device
  file like Atlas does. Builder: confirm in Atlas's build that Atlas merges all device files, so Tabletop's rolls show in
  Atlas too.
- "Give" and "Show to players" are not shown (Atlas hides "give" without an online table; both are "not yet").

### Asset manager

- A full-screen panel over the board, like Atlas's, with Atlas 0.12.0's tabs (scenes, maps, encounters, tokens, party),
  search, folders and thumbnails, in Atlas's markup.
- **Acting on the board:**
  - **Tokens and multi-select:** spawned onto the 3D board at the centre of the camera, laid out and snapped with
    Atlas's rules (ported), avoiding taken squares the way the board's drag-to-another-scene already does. The new tokens
    are selected on the board.
  - **Encounters:** Atlas's three spawn choices: on the map (saved formation), fight (also joins initiative), beside the
    map (off-map combatants, Atlas 0.9+).
  - **Scenes:** open on the 3D board (the board switches to that map; Atlas follows as with scene tabs today).
- **Hand-offs to Atlas** (my call): creating or editing tokens, the encounter builder, creating a scene from a map, the
  dungeon generator, collection settings and imports open Atlas's own UI (`globalAssetManager.open(tab)` or Atlas's
  command), since they don't need the board. The parity table records each as "Atlas".

### Command palette

- Atlas's palette over the board: same entries in the same order, same labels, same search and keys (Space to open,
  type to filter, arrows, Enter, Escape), same sub-pages where Tabletop can serve them.
- Each Atlas entry is one of:
  - **Native:** done on the board (open random tables, dice log, scene levels/layers, token settings that the board
    shows, scene browser through Atlas's `openSceneBrowser`).
  - **Mapped:** the board's equivalent (move tool → board move; measure → the board's drag ruler).
  - **Atlas:** run in Atlas with the existing activate-run-restore pattern (`BoardView.ts:1080`), e.g. player window and
    player-view commands.
  - **Not yet:** shown dimmed in its place with "Open in Atlas" (my call: the list stays identical to Atlas's instead of
    hiding entries), e.g. fog tool, note pin, graphics, customise toolbar.
- Tabletop's existing board settings panel stays where it is.

### Parity table and drift guard

- `src/parity/` holds three typed tables keyed by Atlas id: toolbar tools, palette entries, asset manager tabs. Each row:
  status (`native` | `mapped` | `atlas` | `not-yet`), the handler, and a note. The toolbar, palette and asset manager
  are driven from these tables, so a row is the single place a feature is switched on.
- `scripts/check-atlas-members.mjs` (via `npm run check:atlas`) is extended to pull the ids out of Atlas's built
  `main.js`: toolbar catalog entries (`{id:"…",label:…,hotkey:…,dmOnly:…}`), palette entries (`id:"…",icon:`), asset
  manager tabs. It fails on any id missing from Tabletop's tables or listed but gone from Atlas, and lists them. Every new
  private member is added to `MEMBERS` as usual.
- A short `docs/atlas-parity.md` lists each ported or redrawn file against its Atlas source file, so an Atlas upgrade is
  "diff those Atlas files between versions, apply the changes".

### Calls settled after the builder check (my calls unless marked)

- **History merge (confirmed in Atlas 0.12.0's build):** Atlas's `LootHistoryStore` reads every `*.json` in
  `loot-history/`, follows other devices' files through vault events and only writes its own, so
  `<deviceId>-tabletop.json` shows in Atlas and removals carry both ways through `removed`.
- **Actions that change Atlas's library or settings** (renaming or removing a table, no-repeats, asset edits and
  deletes, tags, collections, imports, statblock links, palette settings pages that write Atlas's `data.json`): Tabletop
  calls **Atlas's own running instance** (its asset service singleton, its `settingsService`). Calling Atlas's instance
  is not a second writer. Where that instance cannot be reached (Atlas not loaded), the control is shown disabled with
  "Needs Atlas". Each member used goes into `check-atlas-members`.
- **Atlas's toolbar customisation:** only the three new buttons follow it: a tool hidden in Atlas is hidden on the
  board, their order among themselves follows Atlas's, and they sit together after Tabletop's existing groups (before
  the end slot). Keys rebound in Atlas for these three apply on the board. Tabletop's existing buttons are untouched.
- **Finding out about Atlas changes:** the developer check (`npm run check:atlas`) is the guard. At runtime Tabletop only
  notes when the installed Atlas is newer than the version the parity tables were checked against (a one-line notice in
  Tabletop's settings tab), so the GM knows the board may lag Atlas.
- **Language:** the panels follow Tabletop's language rule (Obsidian's language when Atlas has it). Atlas 0.12.0 ships
  English, Russian and Chinese, so the panels' strings are taken from Atlas's locale tables for those three (and
  `src/i18n.ts`'s "Atlas ships no translations" note is corrected). The drift check also covers the locale keys used.

## Testing

- Unit tests (`npm test`) for the ported logic against Atlas's behaviour (table rolls with a fixed random source,
  rarity filters, history merge and cap, spawn layout and snapping), the parity tables, and the id extraction (against a
  fixture cut from Atlas 0.12.0's `main.js`).
- UI harness features (`npm run test:ui`) for each panel opening, filtering, rolling and spawning, with Atlas's CSS.
- `npm run check:atlas` passes against the installed Atlas 0.12.0.
- Manual check in Obsidian: each panel with Atlas holding the map and without.

## Left to the builder

- How to reach Atlas's asset index and collection settings when no Atlas view is loaded (read-only file reads are
  acceptable; writing is not).
- Exact markup fidelity per panel (follow Atlas's built output), animations, and the extraction regexes.
- How the base embed is rendered for loot bases, or the fallback.
- Module layout under `src/` beyond `src/parity/` and `src/atlasPort/`, and how far `TokenWriter` is extended.
- README additions (`## Use`) in the house style.
