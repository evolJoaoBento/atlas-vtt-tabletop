# Connect players on the 3D board — design

Date: 2026-10-21. Repos: Tabletop (`C:\Users\joaoo\2075\atlas-vtt-tabletop`, branch `feat/3d-board`) and
Connect (`C:\Users\joaoo\2075\atlas-vtt-connect-tabletop-wt`, the deployed build is branch `combined/sheets-minis`).

## Intent

The GM runs the game from Tabletop's 3D board. Players in an online Connect session follow it live. A player
who has Tabletop installed sees a 3D view in their Obsidian player tab; a player without it keeps today's 2D
view, unchanged. The user's words: the 3D view is "still very rudimentary": the player's view is the board as
the GM's player window shows it, minus the GM-only buttons, with Connect's player interactions. "It's just that
simple."

## Goals

1. **The board drives the session.** What the GM does on the 3D board (move tokens, open doors, run initiative,
   edit HP and conditions, hide or show tokens) reaches Connect players as it does from Atlas today.
2. **3D player view in Tabletop.** In an Obsidian player's session, when Tabletop is installed, the player tab
   shows Tabletop's 3D board drawn from the scene Connect receives. Without Tabletop: today's 2D view.
3. **Walls, doors and lights reach 3D players**, with the GM's Tabletop look: wall materials (textures), wall
   heights, door props (GLBs) and light heights. Doors animate open and closed as the GM toggles them.
4. **Player interactions are Connect's**: move the tokens the GM lets them control, ping, laser, dice. Same
   rules and same GM-side checks as the 2D view.
5. **Camera: free, with a snap to the GM's view.** The player orbits and moves freely. A "GM view" button snaps
   (glides) the camera to the GM's current 3D board camera.

6. **Everything the 2D player view has, in 3D** (user: "add everything, to dm as well"): moves, ping, laser,
   dice, measurement ruler, map templates (add, remove, clear own), readable pins with their notes, rolls from
   the player's own sheet (token sheets), text labels, drawings, handouts. A "back to 2D" toggle exists only
   as a convenience.
7. **The GM's board gets the same**: players' pings, lasers and templates are drawn on the GM's board; the GM
   can place and clear templates there and sees handouts shown. (My reading of "to dm as well": every
   session feature added for 3D players also exists on the GM's board where it makes sense for a GM.)

## Non-goals

- No new player powers. Players cannot open doors, edit walls, lights, materials or anything else. (No door
  action exists in Connect today; adding one would be a new feature.)
- No 3D on the web join page. The web page stays exactly as it is and must not break: it never receives the
  3D-only data, never fetches GLBs or material textures (standing rule: minis never on the web page).
- No changes to the 2D player view for players without Tabletop.
- No GM-only buttons in the player's 3D view: no player-view button, no freeze button, no board settings (fog
  height, ambient), no wall/light/material editing, no Alt-copy, no HP bar editing, no GM token menu.

## Anti-goals (a failure even if it technically works)

- A player sees something the 2D view would hide from them: a hidden token, a token or wall under fog, a pin,
  a GM label, GM resources, a closed secret door as a door, a light bulb marker.
- The web page or an older Connect player client breaks because of the new data.
- The GM's game stops working when no player has Tabletop, or when Tabletop is missing on the GM side.

## Constraints

- **Stock Atlas only** (vanilla Atlas 0.9.0 in vault 2075; 0.8.0 elsewhere). No Atlas fork features.
- **Tabletop owns all 3D code.** Connect has no renderer. Connect hands Tabletop data and callbacks through
  Tabletop's public API and passes bytes for assets; it never imports three.js.
- **GLBs self-contained** (no Draco/Meshopt).
- **Protocol**: Connect's wire protocol is version 1 (`src/app/online/protocol.ts`). Existing messages and
  `PlayerScene` are not changed in a way an older client would reject. New data travels in new message types
  that an older client ignores, sent only to players who asked for them.
- Fingerprinted assets: every new file (material texture, prop GLB) goes through Connect's existing asset path
  (`asset-request` / `asset-start` / `asset-end`, SHA-256 checked, IndexedDB cache).
- Tabletop's public API stays backward compatible: `version: 1` members (`placementsFor`, `onChange`,
  `readMini`, `playerMinis`) keep working; new members are additions.

## How it works (the parts decided)

### GM side: the board drives the session

- Connect already projects players' scenes from Atlas's live store, and the board already writes through
  Atlas's store (`updateToken`, `toggleDoor`, initiative actions…) whenever Atlas holds the map. So the board
  drives the session **when the map is also open in Atlas and presented** (it may sit in a background tab).
- **(My call)** While Connect is hosting and the map open on the board is not held by Atlas, the board shows a
  small banner: "Players don't see changes made here: open this map in Atlas." with an "Open in Atlas" button
  (opens the map in an Atlas tab without stealing focus). The board does not present by itself; presenting
  stays where it is today (Atlas's eye / Connect).
- The board's own look data (wall materials, wall heights, door props, light heights, props, fog height,
  ambient) lives in Tabletop's plugin data. Tabletop exposes it through a new API member (below) so Connect can
  send it.
- The GM's 3D board camera is reported through the API so Connect can send it for the snap.

### What 3D players receive (new, only to players who asked)

A player whose 3D view is open sends a new message asking for the 3D extras for the scene. The GM then sends,
for that player only, a **board extras** record for the current scene, and updates as it changes:

- **Visibility rule (my call, after review):** everything below is filtered in Connect with the same rules as
  the 2D projection (`projectForPlayers`): the GM's fog *and* the dynamic-lighting frame (what Atlas's
  lighting says players can see). Nothing reaches a 3D player that the 2D view would hide.
- **Walls and doors**, player-safe: the segments and doors the GM's player window would draw (not under fog;
  a closed secret door is sent as plain wall; an open secret door is sent as an open passage/door as Atlas
  shows it). Each with its height, material reference, door state (open/closed, swing) and door prop reference.
- **Lights**: the lights that are not hidden, with colour, bright/dim radius, height, flicker. No bulb
  markers are drawn for players (as in the GM's player window). **(My call)** A fixed light under fog is still
  sent, since its glow can reach revealed ground; this leaks only its position in the data. A light carried by
  a token is sent only when that token is sent to that player.
- **Ambient light** and fog height (the board's look).
- **Props** that are not under fog.
- **Materials**: per material its texture maps and scale, as fingerprinted image assets.
- **Prop and door-prop GLBs** as fingerprinted assets (same path as minis).
- **The GM's camera for the snap (my call):** the camera of the GM's player window (frozen or following) when
  one is open on the presented map, else the GM's board camera when the board shows the presented map, else
  none (the "GM view" button is disabled). Throttled like today's `scene-camera`, as its own message.
- **Board support signal (my call):** on admission the GM tells the player whether it can send board extras
  (Connect with this feature + Tabletop on the GM side). A player shows 3D only when its own Tabletop offers
  the player board *and* the GM said yes; otherwise 2D. An older GM sends nothing, so its players stay on 2D.

Everything else (map image, grid, visible tokens with minis, fog operations, darkness, initiative, texts,
drawings, pings, lasers, templates, dice) is today's player scene, unchanged.

### Player side: the 3D view

- When the player's session tab opens and Tabletop's API offers the player board (new API member), Connect
  shows Tabletop's 3D view in the tab instead of the 2D canvas. If Tabletop arrives or leaves during the
  session, the tab switches view. **(My call)** A small toggle in the tab lets the player go back to 2D.
- Tabletop draws it with the same rules as the GM's player window today: fog fully solid, a camera inside the
  fog sees black, hidden tokens absent (they are not sent anyway), player labels and badges, no cell outline,
  no light bulbs. Pins: only the readable pins Connect sends, as in 2D (clicking opens the note).
- **Darkness (my call):** the dynamic-lighting darkness Connect adds to the fog (fog op id
  `atlas-lighting-darkness`) is drawn as black ground, not as solid fog blocks; the GM's own fog stays solid.
- **Toolbar**: Move/Select and Laser (with its colours and size), and the "GM view" snap button. The player
  view button, freeze button and board settings panel are absent. The initiative tracker (read-only, as in
  the 2D view) can be shown/hidden with I.
- **Interactions**, all sent through Connect's existing player messages:
  - drag a token the player controls → `token-move` (refused moves snap back, as in 2D);
  - laser → `laser`; ping (**my call:** double-click / the same gesture as 2D) → `map-ping`;
  - dice: Connect's dice tray stays available in the tab as in the 2D view;
  - ruler (with the scene's measurement and grid snap), templates → `map-template`, pin notes →
    `note-request`, own sheet and its rolls → `sheet-roll`, handouts shown as in 2D, texts and drawings drawn
    on the board.
  - Other people's pings and lasers are drawn on the board.
- Camera starts on the GM's view, then is free; "GM view" glides back to the GM's latest camera.

### Tabletop API additions (sketch; exact shapes left to the builder)

- GM side: a reader of the board extras for a map path (player-safe filtering may live in Connect or
  Tabletop, builder's choice, but must use the same fog rules the player window uses), a change listener,
  readers for material texture and prop bytes, and the board camera with a change listener.
- Player side: a factory that mounts a player board into an element, takes Connect's player scene plus the
  board extras and asset lookups (image URL / ArrayBuffer by fingerprint), and calls back for moves, pings and
  lasers; with `update`, `camera(gm)`, `dispose`.

## Left to the builder

- Message names and exact record shapes for the new extras, request and camera messages.
- Whether player-safe filtering of walls/props/lights happens in Connect or in Tabletop (one place, tested).
- How the player board maps Connect's `PlayerScene` into Tabletop's `BoardMap` (adapter vs. a new data source
  behind the `BoardHost`).
- How assets are looked up (object URLs vs. ArrayBuffers).
- Unit tests for filtering, protocol encode/decode and the scene adapter; the browser harness for the player
  board (no GM-only buttons, interactions emit the right calls).

## Out of scope for now

- Players opening doors; per-player camera lock by the GM; split-party scenes on the 3D view beyond what the
  player's current scene is; mobile/web 3D.
