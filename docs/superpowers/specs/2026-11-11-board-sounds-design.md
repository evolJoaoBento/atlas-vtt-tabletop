# Board sounds and the spell cast animation

Status: design, questions answered, waiting for approval. Date: 2026-11-11.

## Why

The 3D board is silent. Things move on it (dice tumble, minis drop with a ring and dust, doors swing, spells flare)
and nothing is heard, so the table feels dead and players miss things happening (whose turn it is, a spell landing,
fog going down). The rule the user gave: **if it has an animation, it should have a sound.**

Spells also show their full animation (flames, particles) while the caster is still choosing where to put them, which
spoils the moment of the cast. The animation should belong to the cast.

## Goals

1. A sound for each animated interaction listed below, played on every board that shows the animation.
2. Dice that sound like the dice in Atlas VTT: a clack per hit, so a long roll sounds long and a short roll short.
3. Spells: while aiming, a plain coloured shape with no animation; on cast, the shape grows into place with its
   damage type's animation and its damage type's impact sound.
4. Every sound royalty free: CC0 (no attribution needed), or made by us. Sources recorded in the repo.

## Non-goals

- No music, ambience player or soundboard (Atlas has its own; Tabletop does not copy it).
- No sound for the laser pointer, or for discovering the map through line of sight.
- No voice chat, no sounds the GM uploads (could come later; not in this design).

## Anti-goals (a failure even if it works)

- Copying Atlas's sound files, or any sound whose licence is unclear. Atlas's dice sound is the reference for how it
  *behaves*, not a source.
- A dice roll that plays one fixed clip regardless of how long the dice roll.
- Twenty minis moved together making one sound, or twenty sounds at the same instant (a wall of noise).
- Sounds that keep playing in a hidden or closed board, or that stack up after the board was away (a burst of every
  missed sound when a tab comes back).
- Spell flames, particles or sounds while the spell is only being aimed.

## The rule for who hears what

A sound plays where its animation plays: each board (the GM's Obsidian board, a player's Obsidian board, the web player
board in a browser) plays the sound of an animation at the moment that board draws it. Nothing is sent over the session
for sound; boards already receive the events that drive the animations. A board that is not visible (Obsidian tab in
the background, browser tab hidden) plays nothing and does not queue.

Board events are placed in the room: quieter the farther from the camera, panned a little left or right by where they
are on screen. Interface-like sounds (the turn horn, the fog chime) are not placed.

Our calls on edge cases:

- **Moves seen from other boards.** The landing ring only plays on the board of whoever dropped the mini; other boards
  see the token slide. Their slide counts as the animation: pickup sound when it starts, put-down when it ends, so
  players hear the GM moving monsters. A group arriving at once is staggered the same way.
- **Local player window** (`PlayerWindow.ts`, the pop-out on a TV at the table) plays no sound of its own. The GM's
  machine plays each sound once, placed by the GM's camera. While that window is open, the turn horn plays at full
  volume on the GM's machine, since the players at the table hear that machine.
- **Hidden spells.** A cast a board does not draw (out of sight, under fog) makes no sound there.
- **Monster turns.** No player controls the token, so the horn plays at full volume on the GM's board only. Every
  player who controls the token whose turn it is gets it at full volume.
- **Condition names** match English 5e names, ignoring case, plus a small alias table, starting with Portuguese and
  Spanish. Anything else gets the neutral tick.

## The sounds

| Event | Sound | Notes |
|---|---|---|
| Dice hit the table, a wall or each other | a clack per hit, louder for harder hits, pitch varied a little per die size (d4 brighter, d20 fuller) | Driven by the physics contacts, like Atlas. A soft rolling layer under it while any die moves fast enough, fading as they slow. Many hits in the same few milliseconds are thinned so a big handful does not clip. |
| A die comes to rest caught (on an edge, or never settling) | a short "wrong" sound (a dull buzz/thunk) | Plays once when it is read caught (`diceTable.ts`, `caught: true`). |
| A mini picked up | a light lift (wood/plastic off felt) | Includes the GM dragging and a player grabbing their own token. |
| A mini put down / landing | a thud, timed with the existing ring and dust (`impact.ts` `land`) | Same sound for a token dropped onto another scene. |
| Several minis moved together | each mini its own pickup and put-down, staggered by a few tens of ms, slightly varied | Never one sound for the group, never all at once. |
| Door opens / shuts | a creak-and-swing for open, a thud-latch for shut | A locked door clicked: a short rattle (our call). |
| Wall material swapped | a crumble (stone/debris) | Timed with the existing flash and dust (`impact.ts` `slap`). |
| Fog of war placed by the GM | a small soft chime | Only for fog the GM places or reveals by hand. Line-of-sight discovery stays silent. |
| Initiative: next turn | a horn call | Full volume on the boards of the players who control the token whose turn it is; quiet for everyone else, including the GM. |
| Condition applied to a token | a sound per condition (see below) | Removing a condition is silent (our call). |
| Spell cast | an impact per damage type (see below) | Plays as the cast animation starts. |
| A spell that stays on the board (lasting: a Wall of Fire, a Spirit Guardians) | a quiet loop per damage type (a crackling fire, a cold hum, a buzzing field...) | Heard only when the camera is near it, louder the closer, like water; fades in and out; stops when the spell is cleared or ends. |
| Water near the camera | a loop per water motion: still, ripples, flow, waves | Heard only when the camera is near painted water; louder the closer. Still water nearly silent. Fades in and out, never starts or stops abruptly. |

### Conditions

Conditions come from each Atlas collection (they can be custom). A condition whose name matches a D&D 5e condition gets
its own sound; any other gets a neutral "applied" tick. Our first take on each, to be tuned by ear:

blinded (a muffled whoomp), charmed (a sweet shimmer), deafened (a ringing that dulls), exhaustion (a weary exhale
tone), frightened (a sharp shiver sting), grappled (a rope/cloth tug), incapacitated (a dull drop), invisible (a fading
shimmer), paralyzed (a freezing lock tone), petrified (stone grinding), poisoned (a gurgle), prone (a body thump),
restrained (chains/rope), stunned (a ring like a struck bell), unconscious (a slow falling tone).

### Spell impacts, one per damage type

Spells already carry a damage type (`spells.ts`: D&D's thirteen and an explosion, each with its own look in
`spellEffects.ts`). Each gets its own impact: acid (sizzle), bludgeoning (heavy thud), cold (cracking ice), explosion
(boom), fire (roaring whoosh), force (a deep pulse), lightning (a snap and crackle), necrotic (a dark hiss), piercing (a
volley of thin hits), poison (a wet hiss), psychic (a warbling ring), radiant (a bright swell), slashing (a blade sweep),
thunder (a booming crack). A spell with no damage type gets a plain magical impact.

A lasting spell also gets its damage type's loop while it stays on the board (the user asked for it). Several lasting
spells of the same type near the camera share one loop at the loudest of their levels, so ten fire walls do not
stack ten loops (our call).

## Spell cast animation

While a spell is aimed, set and confirmed (`spellCaster.ts` `preview`), the board draws only a flat, see-through
coloured shape in the damage type's colour (`DAMAGE_COLORS`), with what it hits outlined as today. No particles, no
flames, no moving shaders, no sound.

When the spell is cast, the shape grows into place over about half a second (eased), then the damage type's animation
plays and the impact sound plays as the growth starts:

- **Sphere**: grows from its centre.
- **Cube**: grows from its centre.
- **Cylinder**: rises from its base.
- **Wall**: rises from its foot along its whole length.
- **Cone**: not specified by the user; our call: it grows out from its tip along its direction.

The rest of what a cast does stays as it is now (instantaneous spells fade after the cast; lasting ones stay). Every
board that shows the cast (the GM's and every player's) plays the growth, the animation and the sound.

## Settings

In Tabletop's settings (and a small volume control on the web player board, which has no settings tab):

- Master volume, and mute.
- An on/off per group: dice, minis, spells (impacts and loops), conditions, turns, fog, doors and walls, water.

Settings are per device, not shared across the session. Default: on, at a moderate volume.

## Sound files

- Sources, in order of preference: sounds we make (Web Audio synthesis, or recorded and processed by us), then CC0
  packs (for example Kenney's audio packs, or freesound.org items filtered to CC0). Nothing CC-BY unless the user agrees
  to show credits, nothing "royalty free" with redistribution limits (the plugin's repo is public, so the raw files are
  redistributed).
- `src/assets/sounds/SOURCES.md` lists each file: what it is, where it came from, its licence, and what was changed.
- Several variations for frequent sounds (dice hits, pickups, put-downs) so they do not repeat audibly.
- Bundled into the plugin (it ships as one `main.js`); keep the whole set small (target: under 1.5 MB). Sounds load
  after the board opens and never delay it.

## Left to the builder

- Audio format (one that `decodeAudioData` reads in Obsidian on desktop and mobile and in Safari for the web player).
- The exact gain curves, distances, stagger and thinning numbers; tuning by ear.
- Where the sound engine sits in the code, as long as every board kind (`board.ts`, the player board, the web player
  board) uses the same one.
- Whether a sound is synthesized or a sample, case by case.

## How it is checked

- Unit tests for the pure parts: which event maps to which sound, the condition name matching, the stagger for group
  moves, the hit thinning, the distance and pan maths, the settings.
- Browser checks (`harness/`) that each event asks the engine for its sound (the engine stubbed), and that the spell
  preview has no animation and the cast grows from the right anchor.
- A listen in the real promo setup (GM and two players) before calling it done.
