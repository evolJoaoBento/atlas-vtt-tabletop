# Parity with Atlas's toolbar

Tabletop's 3D board offers the tools on Atlas VTT's scene toolbar the Atlas way, on the same data. This page says where
each piece comes from, so a new Atlas can be brought in quickly.

## What the board does for each Atlas tool

`src/parity/` lists every tool on Atlas's toolbar, every command palette entry and every asset manager tab, with what
the board does for it (`native`, `mapped`, `atlas` or `not-yet`). `npm run check:atlas` reads the same ids from the
installed Atlas build and fails when they differ.

## Atlas's own code, copied

`npm run sync:atlas` copies Atlas's code from an Atlas source checkout (default `../atlas-vtt-0.12-ref`) into
`src/atlasPort/app/`, in Atlas's folder layout under `src/app`, so the copies import each other unchanged. It copies the
files listed in `scripts/atlasPortList.mjs` (`PORT_ENTRIES`) and every Atlas file they import, except the boundaries
(`BOUNDARIES`), whose imports point at Tabletop's stand-ins in `src/atlasPort/shims/`. Never edit the copies: change the
list or a stand-in and run the sync again. Each copy starts with its Atlas source path and version.

It also copies Atlas's texts (in every language Atlas speaks) that the copies use and that `src/atlasPort/atlasTextKeys.ts`
lists, into `src/atlasPort/atlasTextData.ts`.

| Tabletop | Atlas 0.12.0 source |
| --- | --- |
| `src/atlasPort/app/randomTables/*` | `src/app/randomTables/*` (table reading, rolling, generators) |
| `src/atlasPort/app/loot/*` | `src/app/loot/*` (loot rolls, rarities, roll history, loot bases) |
| `src/atlasPort/app/stores/lootRollerSlice.ts` | the random tables window's state, saved in the map |
| `src/atlasPort/app/tools/*`, `gameSystems/*` | dice formulas used by tables and generators |
| `src/atlasPort/toolbarLayout.ts` | `src/app/toolbar/toolbarLayout.ts`, `toolbarCatalog.ts` (hand-copied) |
| `src/atlasPort/atlasText.ts` | `src/app/i18n/index.ts` (hand-copied) |
| `src/atlasPort/shims/*` | stand-ins for Atlas's i18n, React hooks' types, asset service types and install record |
