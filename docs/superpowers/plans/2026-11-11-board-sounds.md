# Board Sounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every animated interaction on Tabletop's 3D board makes a sound. Spells show a plain shape while aimed, and grow into place with their animation and sound on cast.

**Architecture:** There is one sound engine per window (`src/sound/`), and every board kind uses it: the GM's `Board`, the player board (Obsidian and web) and the local player window. The engine hides Web Audio behind a small interface. Pure modules decide which sound to play, how loud, where, and when to thin or stagger. The board calls the engine at the places where it already starts each animation. Sounds are short MP3 files bundled into `main.js` as binary, decoded lazily after the board opens.

**Tech Stack:** TypeScript, three.js, cannon-es (dice), Web Audio API, esbuild (`binary` loader), node:test (`npm test`), Playwright harness (`npm run test:ui:all`), ffmpeg (encoding, dev only).

**Spec:** `docs/superpowers/specs/2026-11-11-board-sounds-design.md`

## Global Constraints

- Every sound file is CC0 or made by us. Nothing CC-BY, nothing "royalty free" with redistribution limits. Atlas's sound files are never copied.
- `src/assets/sounds/SOURCES.md` lists every file: what it is, where it came from, its licence, and what was changed.
- The whole sound set is under 1.5 MB.
- Sounds load after the board opens and never delay it.
- A board that is not visible (`document.hidden`) plays nothing and queues nothing.
- Nothing about sound goes over the session. Each board plays what it draws.
- Settings are per device: master volume, mute, and an on/off for each group (`dice`, `minis`, `spells`, `conditions`, `turns`, `fog`, `doors`, `water`). Defaults: on, moderate volume (master 0.6).
- Silent, by design: the laser pointer, line-of-sight discovery, and a condition being removed.
- The format must decode with `decodeAudioData` in Obsidian (desktop and mobile) and in Safari (the web player). Use MP3, mono, 44.1 kHz.
- Run the browser checks with `PLAYWRIGHT_MODULE` set to an installed Playwright and `ATLAS_CSS=../.obsidian/plugins/atlas-vtt/styles.css`.

## Review Focus

1. **A board that opens, or a map that loads, on a scene that already has lasting spells, fog, conditions or a turn under way** plays none of their one-shot sounds. Only changes after the first load sound; loops start quietly. Tests: Task 6 (fog, conditions, turn) and Task 7 (spells).
2. **A web player board in a browser that blocks audio until a gesture** stays silent with no error until the first tap, then plays. Nothing queued from before the tap plays at that tap. Test: Task 1 (`resume on first gesture`).
3. **A handful of 20 dice thrown at once** never plays more than the thinning cap of hits per 50 ms window, and never clips. Test: Task 1 (`Thinner`) and Task 4.
4. **The GM's own drag echoed back by the session** (the sync arriving at the position the token was dropped at) plays no second pickup or put-down. Test: Task 5.
5. **A tab hidden during a fight, then shown again,** plays no burst of the sounds it missed. Test: Task 1 (`hidden plays nothing, queues nothing`).

---

## File Structure

- `src/sound/soundEngine.ts`: `SoundEngine` (one Web Audio context per window): `play`, `loop`, `configure`, buffers loaded lazily, gated by visibility and settings.
- `src/sound/placement.ts`: pure. Distance gain and stereo pan from camera and point; nearness to water and spells.
- `src/sound/thinning.ts`: pure. `Thinner` (cap per window) and `staggerOffsets`.
- `src/sound/catalog.ts`: every sound id, its group, its variant files, its base gain, and whether it is placed.
- `src/sound/conditionSounds.ts`: pure. A condition name to a sound id (5e names and aliases).
- `src/sound/soundSettings.ts`: `SoundSettings`, its defaults, and `readSoundSettings`.
- `src/assets/sounds/*.mp3` and `src/assets/sounds/SOURCES.md`: the files.
- `scripts/sounds/fetch-kenney.mjs`: downloads the CC0 Kenney packs into `.sound-src/` (gitignored).
- `scripts/sounds/synth.mjs`: renders our own sounds to WAV.
- `scripts/sounds/build-sounds.mjs`: picks the files, encodes them with ffmpeg, and writes `src/assets/sounds`.
- Modified:
  - `esbuild.config.mjs`, `scripts/build-web.mjs`, `tests/run.mjs` and `harness/run-ui.mjs`: add an `.mp3` binary loader.
  - `main.ts`: settings (shape, defaults, settings tab rows).
  - `src/board/board.ts`: the hooks.
  - `src/board/spellView.ts`: the plain preview and the growth.
  - `src/dice/diceTable.ts`: hits, rolling, caught.
  - `src/board/BoardView.ts`, `src/playerBoard.ts` and `src/web/playerBoardWeb.ts`: hand the engine to the board; the web volume control.
  - `.gitignore`: add `.sound-src/`.

---

### Task 1: Sound engine, placement, thinning, settings

**Files:**
- Create: `src/sound/soundEngine.ts`, `src/sound/placement.ts`, `src/sound/thinning.ts`, `src/sound/soundSettings.ts`
- Test: `tests/soundEngine.test.ts`, `tests/soundPlacement.test.ts`, `tests/soundThinning.test.ts`

**Interfaces:**
- Produces:
  - `type SoundGroup = 'dice' | 'minis' | 'spells' | 'conditions' | 'turns' | 'fog' | 'doors' | 'water'`
  - `interface SoundSettings { volume: number; muted: boolean; groups: Record<SoundGroup, boolean> }`
  - `DEFAULT_SOUND_SETTINGS`: volume 0.6, not muted, every group on.
  - `readSoundSettings(raw: unknown): SoundSettings`: anything missing or malformed takes its default; volume is clamped to 0..1.
  - `interface Listener { eye: {x,y,z}; target: {x,y,z} }` (board space)
  - `placeAt(listener: Listener, at: {x,y,z}, span: number): { gain: number; pan: number }`
    - gain is 1 within `0.25*span` of the eye, falls linearly to 0.15 at `2*span`, and stays at 0.15 beyond that.
    - pan runs −0.6..0.6, from where the point is across the line from eye to target.
  - `nearness(distance: number, reach: number): number`: 1 at distance 0, 0 at `reach` or more, smoothstep in between.
  - `class Thinner { constructor(cap: number, windowMs: number); take(nowMs: number): boolean }`
  - `staggerOffsets(count: number, stepMs = 45, jitterMs = 15, random = Math.random): number[]`: the first is 0, each one after it is later, and the result is sorted.
  - `interface PlayOptions { at?: {x,y,z}; gain?: number; rate?: number; delayMs?: number }`
  - `class SoundEngine`:
    - `static shared(win: Window, load: (id: SoundId) => Promise<ArrayBuffer[]>): SoundEngine`
    - `play(id: SoundId, options?: PlayOptions): void`
    - `loop(key: string, id: SoundId | null, gain: number): void` (gain eased over 400 ms; `null` stops it, with a fade)
    - `setListener(listener: Listener, span: number): void`
    - `configure(settings: SoundSettings): void`
    - `dispose(): void`
  - `SoundId` comes from Task 2's `catalog.ts`. In this task, define `type SoundId = string` in `soundEngine.ts`; Task 2 narrows it.

- [ ] **Step 1: Write the failing tests**

`tests/soundPlacement.test.ts`:
- `placeAt` at the eye gives gain 1 and pan 0. At `5*span` it gives gain 0.15.
- A point to the right of the eye→target line gives pan > 0, and one to the left gives pan < 0. |pan| ≤ 0.6.
- `nearness(0, 10) === 1`, `nearness(10, 10) === 0`, and `nearness(5, 10) === 0.5`.

`tests/soundThinning.test.ts`:
- `new Thinner(6, 50)`: 20 `take(t)` calls at the same t give exactly 6 trues. At t+51, `take` is true again.
- `staggerOffsets(5, 45, 15, () => 0.5)` deep-equals `[0, 45, 90, 135, 180]`. With `Math.random`, the result is sorted, the first is 0, and every gap is ≥ 30.

`tests/soundEngine.test.ts`: use a fake `AudioContext` (records `createBufferSource().start(when)` calls and gain values), injected via `SoundEngine.forTest(fakeContextFactory, fakeDocument, load)`.
- **`plays once loaded`:** play right after construction before buffers decode; once they decode, exactly one source starts.
- **`hidden plays nothing, queues nothing`:** with `fakeDocument.hidden = true`, `play` starts nothing. After `hidden = false` and a visibilitychange event, still nothing has started.
- **`resume on first gesture`:** the context starts `suspended`. A `play` before any gesture starts nothing. After a `pointerdown` on the document, the context is resumed, the sound from before is not played, and the next `play` starts a source.
- **`settings gate`:** a group off, or muted → nothing starts. The master volume scales the gain node.
- **`loop eases`:** `loop('w', 'water.ripples', 0.5)` starts one looping source. A second call with gain 0.2 reuses the same source. `loop('w', null, 0)` ramps the gain to 0 and then stops the source.
- `readSoundSettings({ volume: 7, groups: { dice: false } })` returns volume 1, dice false, and the other groups true.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: the new tests fail (modules missing).

- [ ] **Step 3: Implement the four modules**
- One context per window, kept on a `WeakMap<Window, SoundEngine>`.
- `load` is called once per id, on its first `play`/`loop`. Each variant decodes with `decodeAudioData`.
- A `play` whose buffer is not decoded yet plays when decoding finishes, but only if that is within 300 ms of the call (drop it otherwise).
- Variants: pick one at random. Rate is the options' rate times `1 ± 0.04`.
- Chain: source → gain → `StereoPannerNode` → the group's gain → master gain → destination.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

`git add src/sound tests/sound*.test.ts && git commit -m "feat(sound): one sound engine per window, placement, thinning, settings"`

---

### Task 2: The sound files and the catalogue

**Files:**
- Create: `scripts/sounds/fetch-kenney.mjs`, `scripts/sounds/synth.mjs`, `scripts/sounds/build-sounds.mjs`, `src/sound/catalog.ts`, `src/assets/sounds/*.mp3`, `src/assets/sounds/SOURCES.md`
- Modify: `.gitignore`, `esbuild.config.mjs`, `scripts/build-web.mjs`, `tests/run.mjs`, `harness/run-ui.mjs` (add `'.mp3': 'binary'` next to `'.png': 'binary'`), `src/assets.d.ts` (declare `*.mp3` as `Uint8Array`)
- Test: `tests/soundCatalog.test.ts`

**Interfaces:**
- Consumes: `SoundGroup` (Task 1).
- Produces:
  - `type SoundId` (the union of the ids below)
  - `CATALOG: Record<SoundId, { group: SoundGroup; files: Uint8Array[]; gain: number; placed: boolean; loop?: boolean }>`
  - `loadSound(id: SoundId): Promise<ArrayBuffer[]>` (copies each file's bytes into a fresh `ArrayBuffer`)

**The sound ids:**
- **Dice:**
  - `dice.hit` (≥ 6 variants)
  - `dice.roll` (loop)
  - `dice.caught`
- **Minis:**
  - `mini.pickup` (≥ 4)
  - `mini.putdown` (≥ 4)
- **Doors and walls:**
  - `door.open`
  - `door.shut`
  - `door.locked`
  - `wall.crumble`
- **Fog, turns, conditions:**
  - `fog.chime`
  - `turn.horn`
  - `condition.<name>` for blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned and unconscious, plus `condition.applied`
- **Spells:**
  - `spell.impact.<damage>` for each of acid, bludgeoning, cold, explosion, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing and thunder, plus `spell.impact.plain`
  - `spell.loop.<damage>` for the same 14, plus `spell.loop.plain` (loops)
- **Water:** `water.ripples`, `water.flow`, `water.waves`, `water.still` (loops; still is very quiet)

Placement: the turn horn and the fog chime are not placed; every other sound is.

- [ ] **Step 1: Write the failing test** `tests/soundCatalog.test.ts`:
- Every id above is in `CATALOG`, and every entry has ≥ 1 file.
- `dice.hit` has ≥ 6 files, and `mini.pickup` and `mini.putdown` have ≥ 4 each.
- The sum of every file's byte length under `src/assets/sounds/` is < 1_500_000.
- Every `.mp3` in `src/assets/sounds/` appears in `SOURCES.md` together with a licence word from {`CC0`, `own`}.
- Every loop entry has `loop: true`.
- `turn.horn` and `fog.chime` have `placed: false`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: it fails (the catalogue is missing).

- [ ] **Step 3: Source and make the sounds**
- **`fetch-kenney.mjs`:** downloads Kenney's CC0 packs with a browser User-Agent and unzips them into `.sound-src/kenney/`. The packs are Impact Sounds, RPG Audio and Interface Sounds, from `https://kenney.nl/assets/<slug>`; the zip link is on each page.
  - dice hits come from Impact Sounds (`impactWood_light*`, `impactPlate_light*`, at a raised pitch)
  - pickups and put-downs come from RPG Audio (cloth and wood)
  - doors come from RPG Audio (`doorOpen_*`, `doorClose_*`, plus a metal latch for locked)
  - the fog chime and `dice.caught` come from Interface Sounds (a chime, and an error)
- **`synth.mjs`:** renders the rest as 44.1 kHz mono WAVs into `.sound-src/own/`:
  - the horn (brass-like stack)
  - the dice roll loop (filtered noise, short grains)
  - the crumble (noise grains plus low thumps)
  - every condition, spell impact and spell loop (filtered noise, FM and oscillators shaped by envelopes)
  - the water loops, seamless (noise through moving band-pass filters)

  Each sound comes from a recipe function in the file, so they can be tuned later.
- **`build-sounds.mjs`:**
  - maps each catalogue id to its source WAV/OGG files
  - trims silence and normalises to −1 dBFS peak
  - encodes with `ffmpeg -ac 1 -ar 44100 -b:a 64k` (loops use `48k`)
  - writes `src/assets/sounds/<id>-<n>.mp3`
  - writes `SOURCES.md`, one row per file: id, file, origin (the Kenney pack and file name, or `own: synth.mjs <recipe>`), licence, and what changed
- Add `.sound-src/` to `.gitignore`.
- `catalog.ts` imports every mp3. One explicit import per file is fine; it can be generated by `build-sounds.mjs`.

- [ ] **Step 4: Run the build and the tests**

Run: `node scripts/sounds/fetch-kenney.mjs && node scripts/sounds/synth.mjs && node scripts/sounds/build-sounds.mjs && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)" && npm run build`
Expected: `# fail 0`, and the build exits 0.

- [ ] **Step 5: Listen**

Run `node scripts/sounds/build-sounds.mjs --sheet`, which writes `.sound-src/listen.html` with one play button per id. Open it and check that nothing clicks at its loop seam, nothing clips, and every condition sound is told apart from the rest. Retune any recipe that fails, then rebuild.

- [ ] **Step 6: Commit**

`git add scripts/sounds src/sound/catalog.ts src/assets/sounds src/assets.d.ts .gitignore esbuild.config.mjs scripts/build-web.mjs tests/run.mjs harness/run-ui.mjs tests/soundCatalog.test.ts && git commit -m "feat(sound): CC0 and own sound set, catalogue, mp3 bundling"`

---

### Task 3: Settings and wiring the engine into every board

**Files:**
- Modify:
  - `main.ts:46-90` (`TabletopSettings.sound: SoundSettings`, the defaults, and load through `readSoundSettings`)
  - `main.ts` `TabletopSettingTab`: a "Sound" group in both `getSettingDefinitions` and `display()`, with a volume slider, a mute toggle and one toggle per group
  - `src/board/board.ts` (host hook `sounds?(): SoundEngine | null`, and `setListener` each frame the camera moves)
  - `src/board/BoardView.ts` and `src/playerBoard.ts` (pass `SoundEngine.shared(win, loadSound)` configured from settings)
  - `src/web/playerBoardWeb.ts` (a small volume and mute control in the corner, kept in `localStorage` under `tabletop-sound` with try/catch)
- Test: `tests/soundSettings.test.ts`, plus a harness check

**Interfaces:**
- Consumes: Task 1's `SoundEngine`, `readSoundSettings` and `DEFAULT_SOUND_SETTINGS`, and Task 2's `loadSound`.
- Produces: `Board.sound(id: SoundId, options?: PlayOptions): void`, a private helper every later task calls. It does nothing when the host gives no engine. Also `Board.soundLoop(key: string, id: SoundId | null, gain: number): void`.
- The local player window (`PlayerWindow`) gets no engine (the spec's call: the GM's machine plays each sound once).

- [ ] **Step 1: Failing test**

`tests/soundSettings.test.ts`: plugin data saved without `sound` loads `DEFAULT_SOUND_SETTINGS`, and saved `{ sound: { muted: true } }` loads as muted with the other defaults.

Harness (`harness/features-test.cjs`, new feature `sound settings`): stub `sounds()` with a recorder engine (`window.boardTest.sounds`, which records `play`/`loop` calls). After a camera move, the recorder holds a listener.

- [ ] **Step 2: Run, see it fail.**

Run: `npm test` and `node harness/run-ui.mjs "sound settings"`.

- [ ] **Step 3: Implement** as listed under Files.

The web control is a speaker button that opens a slider and a mute toggle, styled like the board's other corner buttons in `styles.css`.

- [ ] **Step 4: Run them and make sure they pass.** `npm test`, the harness feature, then `npm run build`.

- [ ] **Step 5: Commit** `feat(sound): sound settings, engine handed to every board`.

---

### Task 4: Dice

**Files:**
- Modify: `src/dice/diceTable.ts`
  - each die body's `collide` event, read for its impact speed (`event.contact.getImpactVelocityAlongNormal()`)
  - `step()`, for the rolling layer
  - `settle()`, for caught
- Test: `tests/diceTable.test.ts`, `tests/diceSounds.test.ts`

**Interfaces:**
- Produces, on `DiceTable`:
  - `onHit: (dieType: string, speed: number, at: {x,y,z}) => void` (default no-op)
  - `onRolling: (fastest: number) => void`, called once per `step` while busy, with the fastest die's speed
  - the existing `onSettled` keeps reporting `caught`

  `at` is in board space; convert with the table's own frame, as the mesh positions are.
- Produces, pure in `src/sound/diceSounds.ts`:
  - `hitSound(dieType: string, speed: number): { gain: number; rate: number } | null`
    - null below speed 0.4
    - gain rises from 0.15 at 0.4 to 1 at 8
    - rate is d4 1.15, d6 1.05, d8 1.08, d10 1.0, d12 0.96, d20 0.92, d100 1.0
  - `rollGain(fastest: number): number`: 0 below 0.5, 0.35 at 6 and above, linear in between
- The board wires these on the table it attaches (`board.attachDice`):
  - `onHit` → `sound('dice.hit', {at, gain, rate})`, through a `Thinner(6, 50)`
  - `onRolling` → `soundLoop('dice', 'dice.roll', rollGain)`; when not busy, `soundLoop('dice', null, 0)`
  - `onSettled` caught → `sound('dice.caught', {at})`

- [ ] **Step 1: Failing tests**
- `diceSounds.test.ts`: the `hitSound` thresholds and rates above, and the `rollGain` values.
- `diceTable.test.ts` `a thrown die reports its hits, harder ones faster` (seeded like the others): `throwRoll` 1d20, run to rest. There are ≥ 2 `onHit` calls, the first `speed` is greater than the last, every `at.y` ≥ 0, and `onRolling` is called while busy.

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement.**

Attach the `collide` listener in the die factory (`diceTable.ts` near `body.allowSleep = true`). Remove it when the die is removed.

- [ ] **Step 4: Run them and make sure they pass.** `npm test`. Then the harness: a feature `dice sounds` throws 6d6 through the toolbar picker. The recorder sees `dice.hit` calls, never more than 6 in any 50 ms, and a `loop('dice', null, …)` at the end.

- [ ] **Step 5: Commit** `feat(sound): dice clack per hit, rolling layer, caught`.

---

### Task 5: Minis, groups, scene drops, doors, wall swaps

**Files:**
- Modify: `src/board/board.ts`. These are the places:
  - **local pickup:** the press of `kind: 'token'` becoming `moved` for the first time (around line 3592), and a group press there too
  - **local put-down:** `landImpact` (line 2838), which already covers a drop, a group landing (line 3727), a mini assigned (line 3113); a token dropped onto another scene (`BoardView.ts` spawn, line ~514) must reach `landImpact` too: check that it does, and call it if not
  - **remote moves:** the map sync, which sets `entry.goal` from the token (line 1478)
  - **doors:** `toggleDoor` (line 2858)
  - **wall swaps:** `slapImpact` (line 2847)
- Test: `tests/miniSounds.test.ts`, and a harness feature

**Interfaces:**
- Produces, pure in `src/sound/miniSounds.ts`:
  - `remoteMoves(before: Map<string,{x,y}>, after: Map<string,{x,y}>, cell: number, ignore: ReadonlySet<string>): string[]`
    - the ids whose position changed by more than 0.25 cell, minus `ignore`
    - `ignore` is the ids this board itself just dropped, kept for 2 s after each drop: the GM's own drag echoed back
- Board behaviour:
  - **Remote glide:** each id in `remoteMoves` gets `mini.pickup` at offset `staggerOffsets(n)[i]` ms, and is flagged `gliding`. In the glide loop (lines 2338–2350), a `gliding` entry that arrives gets `mini.putdown` at its spot and is unflagged.
  - **Local moves:** pickup when a drag starts, put-down in `landImpact`. Group landings are staggered with `staggerOffsets`.
  - **Doors:** after `toggleDoor`, `door.open` or `door.shut` by the door's new state, or `door.locked` when it is locked and stays shut. Remote door changes, read from the map sync's door states, play the same sounds.
  - **Wall swaps:** `slapImpact` → `wall.crumble` at the middle of the segments.

- [ ] **Step 1: Failing tests**

`miniSounds.test.ts`:
- a token moved by 2 cells is listed
- one moved by 0.1 cell is not
- an id in `ignore` is not listed
- a token that is new or gone is not listed (no pickup for spawns)

Harness feature `mini sounds`:
- dragging a token records one `mini.pickup` and one `mini.putdown`
- a map sync moving 5 tokens records 5 pickups whose `delayMs` are distinct and sorted, then 5 put-downs
- a sync echoing the GM's own drop records nothing
- clicking a door records `door.open`, then `door.shut`
- a material slapped on a wall records `wall.crumble`

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and make sure they pass.** `npm test`, and `node harness/run-ui.mjs "mini sounds"`.

- [ ] **Step 5: Commit** `feat(sound): minis picked up and put down, groups staggered, doors, wall swaps`.

---

### Task 6: Fog chime, turn horn, conditions

**Files:**
- Create: `src/sound/conditionSounds.ts`, `src/sound/boardChanges.ts`
- Modify:
  - `src/board/board.ts`, where a map is applied (the block that calls `this.fog.update(map.fog, …)` at line 1443)
  - `src/board/BoardView.ts:1597-1606`: the GM board's turn now goes through the board's own watcher, so it isn't detected twice
- Add a host hook `controlledByPlayers?(tokenId: string): boolean` (GM side). BoardView implements it from Connect's controllers in the board session.
- Test: `tests/conditionSounds.test.ts`, `tests/boardChanges.test.ts`

**Interfaces:**
- Produces:
  - `conditionSound(name: string): SoundId`:
    - English 5e names match case-insensitively, trimmed, and ignoring a trailing number (Atlas's valued conditions)
    - aliases: pt `cego cegado enfeitiçado encantado surdo exaustão assustado amedrontado agarrado incapacitado invisível paralisado petrificado envenenado caído derrubado impedido contido atordoado inconsciente`, es `cegado hechizado ensordecido agotamiento asustado agarrado incapacitado invisible paralizado petrificado envenenado derribado apresado aturdido inconsciente`
    - anything else gives `condition.applied`
  - `class BoardChanges` (pure):
    - `constructor()`
    - `next(map: { id: string; fogIds: string[]; tokens: Array<{ id: string; conditions: string[] }>; turnKey: string | null; turnTokens: string[] }): { fogAdded: boolean; conditionsAdded: Array<{ tokenId: string; name: string }>; turnChanged: { tokens: string[] } | null }`
    - the first `next` for a map id reports nothing; so does the first after the map id changes
- Board behaviour on each applied map:
  - `fogAdded` → `sound('fog.chime')`. This is fog the GM places or reveals: any new fog operation id.
  - each `conditionsAdded` → `sound(conditionSound(name), { at: token's spot })`
  - `turnChanged` → `sound('turn.horn', { gain })`:
    - gain 1 when any token in it is one this board controls (player: `host.canMove`)
    - on the GM board, gain 1 when no player controls any of its tokens (a monster's turn), or while the local player window is open
    - else 0.35
  - `turnKey` comes from `turnAnnouncement(map.initiative)?.key`, and `turnTokens` from `currentEntries(map.initiative)` (both in `initiative.ts`).

- [ ] **Step 1: Failing tests**

`conditionSounds.test.ts`: `Prone` → `condition.prone`, ` poisoned 2 ` → `condition.poisoned`, `Envenenado` → `condition.poisoned`, `Caído` → `condition.prone`, `Hexed` → `condition.applied`.

`boardChanges.test.ts`:
- a first map with fog, conditions and a turn reports nothing
- a new fog id → `fogAdded`
- a removed fog id → not added
- a token gaining `Stunned` → listed
- a token losing one → not listed
- the turn key changing → `turnChanged` with its tokens
- a different map id → reports nothing again

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**, and remove BoardView's own `lastTurn` banner trigger only if the board now flashes the banner itself. Otherwise keep the banner where it is and add only the sound in the board.

- [ ] **Step 4: Run them and make sure they pass.** `npm test`. Harness feature `table sounds`:
- setting a map with new fog records `fog.chime`
- adding Prone to a token records `condition.prone`
- advancing the tracker records `turn.horn`
- reloading the same map records nothing

- [ ] **Step 5: Commit** `feat(sound): fog chime, turn horn, a sound per condition`.

---

### Task 7: Spell cast animation, impacts, and lasting spell loops

**Files:**
- Modify:
  - `src/board/spellView.ts`:
    - constructor option `{ plain?: boolean }`: no `SpellEffect`, the shape only, opacity as now
    - `grow(progress: number): void`
    - `get anchorOf(): 'centre' | 'base' | 'tip'`
  - `src/board/board.ts`:
    - the preview (lines 5225–5240): `new SpellView(..., { plain: true })`
    - `drawSpells` (lines 5280–5297): newly cast spells grow, sound, and loop
    - the frame loop: growth progress, and loop gains each frame the camera moves
- Create: `src/sound/spellSounds.ts`
- Test: `tests/spellView.test.ts` (new), `tests/spellSounds.test.ts`

**Interfaces:**
- Produces:
  - `growScale(shape: SpellShape, progress: number): { x: number; y: number; z: number; lift: number }`
    - eased with `smoother` (smootherstep) over the progress
    - sphere and cube: uniform scale from the centre
    - cylinder and wall: y scales from the foot (`lift` keeps the foot on the floor); x and z are already 1
    - cone: scales along its axis from the tip
    - pure, exported from `spellView.ts`
  - `GROW_MS = 500`
  - `castsToAnnounce(seen: Set<string>, firstLoad: boolean, castIds: string[]): string[]`: the ids not yet seen, or none on the first load. Pure, in `spellSounds.ts`.
  - `spellLoopGains(spells: Array<{ id: string; effect: DamageType | null; at: {x,y,z}; lasting: boolean }>, listener: Listener, reach: number): Map<SoundId, number>`
    - one entry per damage type, the loudest `nearness` among that type's lasting spells
    - reach is `6 * cell`
- Board behaviour:
  - Each id from `castsToAnnounce`:
    - its view is made with its effect, and `grow` runs from 0 to 1 over `GROW_MS`
    - `sound('spell.impact.<effect or plain>', { at })` plays when growth starts
  - Spells present at a map's first draw appear fully grown, silent.
  - Every frame the camera moves, `spellLoopGains` → `soundLoop('spell:<id>', …)`. A type no longer present gets `null`.
  - A board that does not draw a spell (out of sight or under fog: the board already skips drawing it) gives it no sound and no loop.

- [ ] **Step 1: Failing tests**

`spellView.test.ts`:
- `growScale('sphere', 0)` has every axis 0
- `growScale('sphere', 1)` has every axis 1, lift 0
- `growScale('wall', 0.5)` has y in (0, 1), and its lift keeps the foot at 0
- `growScale('cylinder', 0.5)` likewise
- `growScale('cone', 0.5)` scales only along its axis
- `new SpellView(fireSpell, '#fff', [], 0.45, 50, { plain: true }).animated === false`

`spellSounds.test.ts`:
- `castsToAnnounce` gives nothing on the first load
- a new id is announced once
- a seen id is never announced again
- `spellLoopGains`:
  - two fire walls give one fire entry, at the louder gain
  - a cold spell beyond reach gives gain 0
  - a spell that is not lasting gives no entry

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and make sure they pass.**

`npm test`. Then update the harness: the `spell search`, `spell rules cast` and `spell ask` features must now see the preview as plain (`board.spellPreview.view.animated === false`). Add a feature `spell sounds`:
- a cast records `spell.impact.fire`
- the view's scale after 250 ms is between 0 and 1, and 1 after 600 ms
- a lasting Wall of Fire with the camera near records `loop('spell:…', 'spell.loop.fire', g > 0)`, and with the camera far, g ≈ 0
- re-sending the same spells records no impact

Run `npm run test:ui:all` (all green).

- [ ] **Step 5: Commit** `feat(spells): plain shape while aimed; cast grows into place with its sound; lasting spells loop near the camera`.

---

### Task 8: Water loops

**Files:**
- Modify: `src/board/board.ts` (where `this.water` is made and updated, and the frame loop)
- Create: `src/sound/waterSound.ts`
- Test: `tests/waterSound.test.ts`

**Interfaces:**
- Produces:
  - `waterDistance(mask: { width: number; height: number; data: Uint8Array }, mapWidth: number, mapHeight: number, point: {x: number; y: number}): number`: map pixels to the nearest painted cell. Searches a coarse grid of the mask (≤ 64×64 samples), cached per mask version.
  - `waterLoop(kind: WaterMotionKind): SoundId`:
    - still → `water.still`
    - ripples → `water.ripples`
    - flow → `water.flow`
    - waves → `water.waves`
- Board behaviour: every frame the camera moves, plus once a second, compute the gain as `nearness(waterDistance(mask, …, camera target), 8 * cell) * (eye distance falloff from placeAt)`, then `soundLoop('water', waterLoop(kind), gain)`. No water → `soundLoop('water', null, 0)`. A change of motion kind swaps the loop with a fade.

- [ ] **Step 1: Failing tests:**
- a mask with water only in the left half: a point in the left half gives 0, a point at the right edge gives > 0.4 × map width
- an empty mask → `Infinity`
- `waterLoop` maps the four kinds as above

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and make sure they pass.** `npm test`. Harness feature `water sound`: painted water with the camera over it records `loop('water', 'water.ripples', g > 0.5)`; moving the camera far records g < 0.1; switching the motion to waves records `water.waves`.

- [ ] **Step 5: Commit** `feat(sound): painted water loops near the camera`.

---

### Task 9: Live check in the promo setup

**Files:**
- Modify: `README.md`: a "Sounds" section listing settings, groups and credits, pointing to `src/assets/sounds/SOURCES.md`.

- [ ] **Step 1:** `npm run build`. Copy `main.js`, `styles.css` and `manifest.json` into `C:\Users\joaoo\tabletop-promo-vault\.obsidian\plugins\tabletop-for-atlas` and the two player vaults. Restart the three Obsidians: `node C:\Users\joaoo\tabletop-promo-session\real\launch.cjs gm 9301`, `player 9302 …` and `kestrel 9303 …`, then `node session.cjs`.
- [ ] **Step 2:** Over CDP, confirm the engine is running on each board: an `AudioContext` in the `running` state, and the recorder off. Exercise each of these once:
  - a dice roll
  - a GM token drag (players hear it too)
  - a group move of 4
  - a door
  - fog placed
  - Prone applied
  - next turn
  - a Fireball cast
  - a Wall of Fire with the camera near
  - water

  Capture the output of one window with a CDP screencast plus tab audio (or `ffmpeg -f dshow` loopback), and listen.
- [ ] **Step 3:** Fix what sounds wrong (level, timing, seams) in the recipes or gains, then rerun `npm test` and `npm run test:ui:all`.
- [ ] **Step 4: Commit** `docs: sounds in the README; tuned by ear`.
