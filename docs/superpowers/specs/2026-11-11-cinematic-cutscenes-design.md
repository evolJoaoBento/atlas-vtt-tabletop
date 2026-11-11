# Cinematic cutscenes

Status: design, questions answered, waiting for approval. Date: 2026-11-11.

## Why

At the table, some moments are staged: a reveal, a role-play scene, the camera sweeping over the docks to the ship.
Today each player moves their own camera, so the GM cannot show everyone the same thing, framed the way they want,
at the moment they want. The GM wants to take the camera away from the players for a while, show them shots they
prepared (or just what the GM's own camera is doing), and give it back where it was.

## Words

- **Cutscene**: everything between the moment control is taken from the players and the moment it is given back.
  While it runs, players cannot move their camera or their tokens; they ask the GM to move things for them. They can
  still roll dice, through a dice button that opens the dice menu.
- **Shot**: a camera position (place and rotation) inside a cutscene. Shots of one cutscene can be on different maps
  (Tabletop scenes / Atlas map tabs).
- **Keyframe shot**: a shot the camera passes through without stopping (made from a shot with a right click).
- **Transition**: what happens between two shots: **fade** (through black), **cut** (instant), or **move** (the
  camera eases position and rotation from one shot to the next). Move exists only between two shots on the same map.
- **Live cutscene**: no prepared shots; the players' cameras follow the GM's camera live. Same rules as a cutscene.

## Goals

1. The GM builds cutscenes per scene, on a timeline, with shots, keyframe shots and transitions, autosaved.
2. The GM previews a cutscene alone, from the start or from any shot.
3. The GM runs a cutscene in front of the players: it stops on each shot and waits for the GM's Next (keyframe shots
   run straight through); Previous goes back.
4. The GM can instead lock the players to the GM's live camera (live cutscene).
5. Entering: each player's view fades to black, then fades in on the cinematic camera. Leaving: fades to black, then
   fades in on the exact camera that player had before.
6. Optional cinematic bars (letterbox) for a wide aspect ratio, a toggle in the cinematic settings.

## Non-goals

- No sound or music design for cutscenes (board sounds are their own design: `2026-11-11-board-sounds-design.md`).
- No video export of a cutscene.
- No animation of tokens, lights or fog by the cutscene: the GM moves things by hand while it runs, and players see it.
- No per-player cutscenes (a split party seeing different cutscenes at once).
- No GM "ask for a roll" (shelved by the user: more complex, a design of its own later).

## Anti-goals (a failure even if it works)

- A player able to move the camera or drag a token during a cutscene (any input: mouse, wheel, keys, touch, pinch,
  token eyes).
- A player left stuck in a cutscene after it ended (or after the GM's Obsidian closed or the session dropped).
- A player who returns to a different camera than they left (the GM's, or a default framing).
- Jerky playback on players' boards (the camera stepping at network rate instead of moving smoothly).
- The normal camera's limits leaking into authoring (the GM must have full freedom while framing shots).

## The GM building a cutscene

1. Each scene (map) has a **cutscene gallery**. A **+** button asks for the cutscene's name, then puts the GM's
   camera in cinematic mode: the cinematic settings apply (bars or not), and the camera moves freely, without the
   normal camera's limits (any pitch including looking up, any distance, rolled or not: our call is no roll unless the
   builder finds it cheap).
2. A **timeline** runs along the bottom of the screen. The GM points the camera where they want, and a left click on
   the timeline creates a shot at that point in time, holding the current camera.
3. Between two shots, a right click on the timeline chooses the transition: fade (default; the default can be changed
   in the cinematic settings), cut, or move (only when both shots are on the same map). The time between two shots
   on the timeline is how long the transition takes (a cut ignores it).
4. A right click on a shot: **make it a keyframe shot** (and back), **preview from here**, update it to the current
   camera (our call), delete it (our call). Shots can be dragged along the timeline to retime them (our call).
5. A chain of keyframe shots on the same map makes one continuous camera path: the camera moves through them smoothly
   (a spline through the positions, rotations eased), without stopping.
6. The GM can switch to another map while editing; the cutscene stays open, and the next shots belong to that map.
   That is how a cutscene crosses maps. A cross-map transition is fade or cut only.
7. Everything autosaves as it changes. Leaving keeps the cutscene; it opens again from the gallery.
8. A cutscene belongs to the gallery of the scene it was created in, even when its later shots are on other maps.
9. **Preview**: plays the cutscene on the GM's board only, from the start or from a shot, with the same Next / Previous
   as a real run, and a way out back to editing.

## The GM running a cutscene

- From the gallery, **Play for players** starts it. Players' boards fade to black, then fade in on the first shot.
- The GM's board shows the same view, with **Previous**, **Next** and **End** controls, and the shot it is on.
- **Next**: plays the transition to the next shot and stops there. If keyframe shots come next, it runs through them
  without stopping and stops on the next ordinary shot.
- **Previous**: back to the previous ordinary shot (our call: a cut, no reverse playback).
- **Next on the last shot**, or **End** at any time: the cutscene ends. Every player fades to black and fades in on
  their own camera from before the cutscene.
- During it the GM can still move tokens, open doors and change fog; players see it happen.
- Shots on another map: the players' boards change map for the shot (this is a real scene change), and return to the
  map they were on when the cutscene ends (our call; the fade hides the load).
- **Live cutscene**: a toggle on the GM's toolbar, "Players follow my camera". Fade in and out, bars and locks are the
  same; the players' cameras follow the GM's camera, smoothed. Our call: the GM's own camera keeps its normal limits
  in a live cutscene.

## What players get

- On start: fade to black, fade in on the cinematic camera, bars if the GM's settings have them.
- Their camera and their tokens are locked (no input moves them). Clicking a token still shows what they could see
  before (sheet, menu) as long as it changes nothing (our call).
- They roll dice through a **Roll dice** button shown during the cutscene, which opens the dice menu (the picker);
  the dice are thrown and logged as any player roll. Other ways in that move or change the board stay locked (our
  call: sheet rolls stay available only if they change nothing on the board; the builder may simply hide them).
- **What players see: everything.** A cutscene reveals what its shots show, fog or no fog, line of sight or not (the
  user's answer). While it runs, the GM's machine sends each player the map as the GM sees it for the shots' maps,
  for this cutscene only. When it ends, every player's board drops it and goes back to what they may see: nothing
  seen in a cutscene is kept as explored, remembered, or left in the player's data. This is a deliberate exception to
  "only what players may see leaves the GM's machine" (`projectForPlayers.ts` in Connect), bounded to the cutscene.
- **Players not on the 3D board** (on Connect's 2D view, on a phone in AR, or where the GM had not offered the board)
  are switched onto the 3D board for the cutscene, behind the fade, and switched back to what they had when it ends
  (the 2D view, AR, or no board), with their camera (or AR placement) as it was.
- A player who joins or reconnects during a cutscene drops straight into it, at the current shot.
- If the GM's session ends, or the GM's board closes, the cutscene ends for everyone (fade back to their own camera).

Our calls on edge cases:

- **Split party.** "Play for players" takes every admitted player. A shot on another map is a temporary view for the
  cutscene. It stays outside the scene assignments (`SceneAssignments`), does not count toward the four-scene cap, and
  never changes who is assigned where. When the cutscene ends, each player goes back to their own assigned scene. In a
  live cutscene the players follow the GM's map too.
- **Local player window** (`PlayerWindow`, the table's TV) plays the cutscene like a player's board. While the GM is
  authoring or previewing, that window holds its last view, so the table never sees the GM framing shots.

## Cinematic settings (GM)

- Cinematic bars: on/off. Aspect ratio: 2.39:1 by default, with a few choices (for example 1.85:1, 2:1, 2.39:1).
- Default transition: fade (or cut, or move).
- Default fade length (our call: 0.6 s each way).

## What exists today, and what is new

From reading the code (main repo, `feat/atlas-toolbar-parity`):

- Camera: `src/board/camera.ts` is an orbit camera (`CameraPose`: target, yaw, pitch, distance) with limits
  (`limitsFor`) and eased goals; `view(eye, target)` sets an exact pose ignoring limits. There is no timed fly-to and
  no keyframing: **new** time-based playback that drives the pose directly.
- GM view to players: Connect already carries the GM's camera (`BoardCamera {sceneId, eye, target}`,
  `connectContract.ts`; wire `board-camera`, at most every 100 ms). Good enough for a live cutscene with smoothing on
  the player side. A prepared cutscene should **not** stream the camera: send the cutscene (its shots) and the current
  step, and let each player's board play it locally so it is smooth. **New** contract fields and wire messages in
  Connect (`connectContract.ts` and `BoardSessionHub.ts` stay in step, as they do today).
- Scenes: switching map reloads the board (`BoardView.switchScene`); players learn the map from Atlas's presented
  scene. Cross-map shots need a scene switch per player that does not move what Atlas presents to them afterwards.
- Storage: per-map data in `data.json` (`BoardData`, `MapData`), autosaved at 500 ms. Cutscenes go in the creating
  map's `MapData`; shots on other maps hold that map's vault path, kept right on rename and delete like the rest.
- Locks: token drags are already gated (`canMove`, `playerBoard.ts`); camera input has no gate yet (pointer, drag,
  wheel, keys, pinch, token eyes in `board.ts`): **new** lock.
- Rolls: player-initiated today (`dice-roll`, `dice-result`); the cutscene only adds a Roll dice button over the
  locked view. No GM roll request (shelved).
- Fog and sight: players get the scene projected for them (Connect `projectForPlayers.ts`). **New**: a cutscene
  projection that reveals the shots' maps for the cutscene's length, and its clean-up.
- Board offer and AR: the 3D board is optional on the player side (`board-offer`, Connect's 2D `CanvasSceneView`,
  AR on phones). **New**: Connect switches a player onto the board for a cutscene and back after.
- Overlays: board UI is absolutely positioned DOM over the canvas; bars and the timeline follow the same pattern above
  everything else.
- The web player board (`src/web`) wraps the same player board, so it gets the player side for free.

## Left to the builder

- The exact timeline look and interaction details beyond the above (zoom, snapping, labels).
- The interpolation maths (spline type, easing curves).
- The free-camera controls in cinematic mode (our suggestion: the usual orbit, plus fly keys WASD/QE and look with a
  drag, with pitch unlocked).
- How a cross-map shot loads on the players' side without changing what Atlas presents.
- The wire message names and versioning in Connect.

## How it is checked

- Unit tests: cutscene data (read, write, rename), timeline maths (which shot at which time, keyframe chains,
  transitions allowed), playback state (next, previous, end, join mid-cutscene), the lock rules.
- Browser checks (`harness/`): authoring, preview, the bars, a player's board locked and restored to its own camera.
- A real run in the promo setup (GM and two players in Obsidian): a cutscene across two maps with fade, cut, move and
  keyframe shots, a live cutscene, a player rejoining mid-cutscene.
