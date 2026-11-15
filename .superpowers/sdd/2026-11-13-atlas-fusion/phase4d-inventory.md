# 4D inventory (2026-11-14, before the plan)

## Atlas
- `playerSight(): TokenPerception | undefined` (`src/app/pixi/lighting/LightingController.ts:216`) = per-token 'seen'|'sensed'|'unseen'; undefined when lighting off. No polygon.
- Polygons: `renderer.currentSight(): Sight { all, regions: SightRegion[] }` (`vision/sight.ts:82`), region `{tokenId, sense, origin, radius, polygon}`.
- `measureLights(kept, tokens)` (`measure/measureLights.ts:122`) pulls ~5000 lines (pixi, i18n): not vendorable.
- atlas-shared has no vision code (only `lighting/lightingConstants.ts`, `vision/polygonBounds.ts`).

## Connect
- `src/connect/stockLighting/{stockLighting,darknessRaster,exploredMemory,visionRules}.ts` (~870 lines). `controllerOf(view)` duck-types `view.renderer.lighting` (or `lightingFeature.controller`); `visibility()` gates on `deps.dynamicLighting()`, `state.lighting.enabled`, `isEnabled()`, `sightIsCurrent()`; reads `currentSight()`, `ambientLight()`, `lightReaches()`; `darknessRaster` → `{status:'ready', tokens: Record<id,Perception>, darkness:{cellSize,cols,rows,shown}, showsExplored}` | unlit | pending. Fail closed.
- Imports types from `@atlas-vtt/api-types` (Disposer, LightingApi, Perception, PlayerVisibility, PlayerVisibilityOptions).
- Consumer `LiveLighting.frame()` (`src/app/online/scene/LiveLighting.ts:42-53`); `projectForPlayers.ts:136` drops unseen tokens, `:146` merges darkness fog (`DARKNESS_FOG_ID = 'atlas-lighting-darkness'`, `darknessFog.ts:14`).
- Players' lights: `projectBoard.ts:77-89` from `objects.lights` and token lights only (no measure lights).
- Never checked live (no player session).

## Tabletop
- Player boards: `sceneAdapter.ts:21,205` split the darkness fog into `map.darkness`, drawn by `DarknessLayer` (`board.ts:856,1558`); `sceneAdapter.ts:192` `sees: false`; player boards get sight 'off'.
- Settings: `lineOfSight.ts:12-17` (SightMode off/players/everyone, default off), `:174-177` (SightStyle rays/cinematic); `main.ts:91-92,374-377,790-799,1161-1176`; `quality.ts:61-64,96-98,102-110`; `BoardView.ts:159-162,575`; `toolbar.ts:81-85,1484-1488`; `tabletopCommands.ts:60-71`; `playerBoard.ts:14,176` (type only).
- board.ts: `:908-911` toolbar; `refreshSight` `:1164-1261` (viewers `sees && !hidden && !downed`; walls = map.walls + ruleWalls; rays: `visibilityPolygon` + `unseenAreas` (sightRooms:395), `inSight`; cinematic: `buildRooms`/`seenRooms`; fallbacks `seenTiles`/`connectedTiles`); `pointBeyond` `:1311`, `beyondSight` `:1336` (GM only under everyone or POV); `:1355` setQuality; `drawMain` `:1870`; showFor veil `:4652`, stacked blackout `:4658`.
- Helpers kept by spells: `spells.ts:263` canSee, `spellView.ts:255` visibilityPolygon, `sightRooms.ts:14` effectOn, `windows.test.ts:28`.
- `ruleWalls`/`ruleLights` `board.ts:694-695`, built in `applyRules` `:5918-5939` (spellRules.ts:230,244); feed sight `:1194`, movement `movementWalls()` `:6123`, drawn lights `rig.update` `:2889`, `ruleState()` `:6128`. `walls.ts:110` drops `spell:` walls; measure `light` never read as a board light.
- Lighting read: `walls.ts:196-199` → `map.lighting {enabled, ambient, ambientColor}`; `BoardView.ts:1596-1597` `lightingOn`; sight never looks at it.
- Tests: `tests/lineOfSight.test.ts`, `sightRooms.test.ts`, `quality.test.ts:6-8`, `windows.test.ts`; harness `line of sight` (:1147), `elevation layers` (:1027, lineOfSight everyone :1062), `lighting from Atlas` (:1365), `spell rules`(:2946,:3069), `windows` (:2354), player-cutscene veil (:5184).
