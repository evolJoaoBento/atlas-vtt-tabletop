# Parity with Atlas's toolbar

Tabletop's 3D board offers the tools on Atlas VTT's scene toolbar the Atlas way, on the same data. This page says where
each piece comes from, so a new Atlas can be brought in quickly.

## What the board does for each Atlas tool

`src/parity/` lists every tool on Atlas's toolbar, every command palette entry and every asset manager tab, with what
the board does for it (`native`, `mapped`, `atlas` or `not-yet`). `npm run check:atlas` reads the same ids from the
installed Atlas build and fails when they differ.

## Atlas's own code, copied

`npm run sync:atlas` copies Atlas's code from an Atlas source checkout (default `../atlas-vtt-0.15-ref`, the 0.15.0 tag: the floor, so a copy never calls what an installed 0.15 lacks) into
`src/atlasPort/app/`, in Atlas's folder layout under `src/app`, so the copies import each other unchanged. It copies the
files listed in `scripts/atlasPortList.mjs` (`PORT_ENTRIES`) and every Atlas file they import, except the boundaries
(`BOUNDARIES`), whose imports point at Tabletop's stand-ins in `src/atlasPort/shims/`. Never edit the copies: change the
list or a stand-in and run the sync again. Each copy starts with its Atlas source path and version.

It also copies Atlas's texts (in every language Atlas speaks) that the copies use and that `src/atlasPort/atlasTextKeys.ts`
lists, into `src/atlasPort/atlasTextData.ts`.

Tabletop needs Atlas 0.15 or later, and the tables above are checked against 0.15.0 (`ATLAS_CHECKED_VERSION`, which a
test keeps equal to `MIN_ATLAS_VERSION`).

The copies are Atlas 0.15.0's source as it is, but for the boundaries and the two patches in `scripts/atlasPortList.mjs`
(Tabletop's own entries in the palette's Settings tab). The screens once hand-ported from Atlas 0.14's `main.js` (the text
dialog shell, the palette's plain scrolling options, the table import's header-row switch) are Atlas 0.15's own files now.
Where Atlas's floating UI joins the page (`host/portalHost.ts`) is a stand-in: Atlas's own would remove the running
Atlas's host, so the copies join that host and never remove it (`src/atlasPort/shims/portalHost.ts`).

| Tabletop | Atlas 0.15.0 source |
| --- | --- |
| `src/atlasPort/app/randomTables/*` | `src/app/randomTables/*` (table reading, rolling, generators) |
| `src/atlasPort/app/loot/*` | `src/app/loot/*` (loot rolls, rarities, roll history, loot bases) |
| `src/atlasPort/app/stores/lootRollerSlice.ts` | the random tables window's state, saved in the map |
| `src/atlasPort/app/tools/*`, `gameSystems/*` | dice formulas used by tables and generators |
| `src/atlasPort/toolbarLayout.ts` | `src/app/toolbar/toolbarLayout.ts`, `toolbarCatalog.ts` (hand-copied) |
| `src/atlasPort/atlasText.ts` | `src/app/i18n/index.ts` (hand-copied) |
| `src/atlasPort/shims/*` | stand-ins for Atlas's i18n, React hooks' types, asset service types and install record |
