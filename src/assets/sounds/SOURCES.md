# Board sound sources

Every file here is one of:

- from Kenney's CC0 packs (https://kenney.nl, public domain dedication, no attribution needed);
- from the Fantasy Ambient Sound Effects Pack by kmontesdev, CC0 (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0);
- from the 2 dice roll (29 throws) pack by RPG and 80 CC0 RPG SFX by rubberduck, both CC0 on OpenGameArt;
- from the Magic Spell SFX pack by Leonardo Calvo (The Sound Rack), **CC BY 4.0**, which needs credit:
  https://thesoundrack.itch.io/freemagicspellsfx, licence https://creativecommons.org/licenses/by/4.0/ (the credit is in the
  README's Credits; the files are cut, faded, normalised and re-encoded, which the licence allows with that notice);
- or synthesised for this project (licence "own").

Nothing else is used. A sound with no row of its own plays another sound's file (the last rows); the file is stored once.
Rebuild with:

    node scripts/sounds/fetch-kenney.mjs && node scripts/sounds/synth.mjs && node scripts/sounds/build-sounds.mjs

The pack originals are not in the repository. The build reads them from `.sound-src/calvo/`, `.sound-src/kmontes/` and
`.sound-src/round1/` (flat folders holding the files named in the table below, downloaded from the pack pages above).

## Changing a built-in sound

A sound is one entry of the `SOUNDS` table in `scripts/sounds/build-sounds.mjs`, and each of its variants is one line.
To swap a file, change that line and run `node scripts/sounds/build-sounds.mjs` from the repository root (it needs
ffmpeg); it rewrites the MP3s in this folder, `src/sound/catalog.ts` and this file.

- Another file from a Kenney pack: change the name in the line, for example `[RPG('cloth1')]` to `[RPG('cloth7')]`
  (the optional arguments are the pitch shift in semitones and the gain). The pack must be fetched first.
- A file from a downloaded pack: put the original in that pack's folder under `.sound-src` and write
  `calvo('<file>')` or `kmontes('<file>')` as the variant (a loop also takes `LOOP_SEG(<start seconds>)`). Credit and
  licence come from the `PACKS` table.
- A file of your own: save it as a WAV at `.sound-src/own/<name>.wav` and write `own('<name>')` as the variant. It must be
  CC0 or made by you; this file's table then says so.
- The base level of a sound is the `gain` of its entry; the build normalises every file to -1 dBFS.

(Players can also replace a sound on their own computer, with no rebuild: see "Custom sounds" in the README.)

| Sound id | File | Origin | Licence | What changed |
| --- | --- | --- | --- | --- |
| dice.hit | dice.hit-1.mp3 | 2 dice roll (29 throws) by RPG (OpenGameArt user) (https://opengameart.org/content/2-dice-roll-29-throws): dice-1.wav | CC0 | first clack, 0.15 s, DC removed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-2.mp3 | 2 dice roll (29 throws) by RPG (OpenGameArt user) (https://opengameart.org/content/2-dice-roll-29-throws): dice-5.wav | CC0 | first clack, 0.15 s, DC removed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-3.mp3 | 2 dice roll (29 throws) by RPG (OpenGameArt user) (https://opengameart.org/content/2-dice-roll-29-throws): dice-12.wav | CC0 | first clack, 0.15 s, DC removed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-4.mp3 | 2 dice roll (29 throws) by RPG (OpenGameArt user) (https://opengameart.org/content/2-dice-roll-29-throws): dice-20.wav | CC0 | first clack, 0.15 s, DC removed, faded, normalised -1 dBFS, mp3 64k |
| dice.caught | dice.caught-1.mp3 | Kenney Interface Sounds: error_001.ogg | CC0 | trimmed, at most 0.3 s, faded, normalised -1 dBFS, mp3 64k |
| dice.caught | dice.caught-2.mp3 | Kenney Interface Sounds: error_004.ogg | CC0 | pitch -2 st; trimmed, at most 0.3 s, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-1.mp3 | Kenney RPG Audio: cloth1.ogg | CC0 | trimmed, at most 0.4 s, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-2.mp3 | Kenney RPG Audio: cloth2.ogg | CC0 | trimmed, at most 0.4 s, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-3.mp3 | Kenney RPG Audio: cloth3.ogg | CC0 | trimmed, at most 0.4 s, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-4.mp3 | Kenney RPG Audio: cloth4.ogg | CC0 | trimmed, at most 0.4 s, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-5.mp3 | Kenney RPG Audio: handleSmallLeather.ogg | CC0 | trimmed, at most 0.4 s, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-1.mp3 | Kenney RPG Audio: bookPlace1.ogg | CC0 | trimmed, at most 0.3 s, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-2.mp3 | Kenney RPG Audio: bookPlace2.ogg | CC0 | trimmed, at most 0.3 s, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-3.mp3 | Kenney RPG Audio: bookPlace3.ogg | CC0 | trimmed, at most 0.3 s, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-4.mp3 | Kenney Impact Sounds: impactSoft_medium_000.ogg + Kenney Impact Sounds: impactWood_light_001.ogg | CC0 | layered; trimmed, at most 0.3 s, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-5.mp3 | Kenney Impact Sounds: impactSoft_medium_001.ogg + Kenney Impact Sounds: impactWood_light_002.ogg | CC0 | pitch -2 st, -2 st; layered; trimmed, at most 0.3 s, faded, normalised -1 dBFS, mp3 64k |
| door.open | door.open-1.mp3 | Kenney RPG Audio: doorOpen_1.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.open | door.open-2.mp3 | Kenney RPG Audio: doorOpen_2.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.shut | door.shut-1.mp3 | Kenney RPG Audio: doorClose_1.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.shut | door.shut-2.mp3 | Kenney RPG Audio: doorClose_2.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.shut | door.shut-3.mp3 | Kenney RPG Audio: doorClose_3.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.locked | door.locked-1.mp3 | Kenney RPG Audio: metalClick.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.locked | door.locked-2.mp3 | Kenney RPG Audio: metalLatch.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| wall.crumble | wall.crumble-1.mp3 | 80 CC0 RPG SFX by rubberduck (https://opengameart.org/content/80-cc0-rpg-sfx): stones_01.ogg | CC0 | trimmed, at most 1.35 s, faded, normalised -1 dBFS, mp3 64k |
| fog.chime | fog.chime-1.mp3 | Kenney Interface Sounds: confirmation_001.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| turn.horn | turn.horn-1.mp3 | own: synth.mjs horn | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.blinded | condition.blinded-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): wind_spell_cast_air_sharp_shoot_02.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.deafened | condition.deafened-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): wind_spell_cast_air_short_noisy_whoosh_02.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.frightened | condition.frightened-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): dark_spell_cast_invoke_raven_fast_01.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.incapacitated | condition.incapacitated-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): Hit_03.wav | CC0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.invisible | condition.invisible-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): wind_spell_cast_air_short_spacious_whoosh_03.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.paralyzed | condition.paralyzed-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): lighting_spell_electric_zap_blast_sparkle_dark_02.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.petrified | condition.petrified-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): earth_spell_cast_morph_rocks_02.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.poisoned | condition.poisoned-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): acid_spell_cast_bubble_poison_03.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.prone | condition.prone-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): Hit_02.wav | CC0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.restrained | condition.restrained-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): 0009_combat_block_shield_d.wav | CC0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.stunned | condition.stunned-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): lighting_spell_electric_zap_blast_sparkle_bright_03.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| condition.applied | condition.applied-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): dark_spell_cast_energy_ball_05.ogg | CC BY 4.0 | trimmed, at most 1.1 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.acid | spell.impact.acid-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): acid_spell_cast_squish_whoosh_impact_01.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.bludgeoning | spell.impact.bludgeoning-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): 0009_combat_staff_hit_c.wav | CC0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.cold | spell.impact.cold-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): Ice_Spell_fast_impact_02.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.fire | spell.impact.fire-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): fire_spell_burst_impact_short_02.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.force | spell.impact.force-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): wind_spell_cast_air_impact_splash_01.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.lightning | spell.impact.lightning-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): lighting_spell_electric_zap_blast_sparkle_bright_04.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.necrotic | spell.impact.necrotic-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): dark_spell_cast_smash_head_blood_01.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.piercing | spell.impact.piercing-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): 0009_combat_dagger_hit_wood_c.wav | CC0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.plain | spell.impact.plain-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): Hit_04.wav | CC0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.poison | spell.impact.poison-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): acid_spell_cast_gas_poison_squish_ball__01.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.psychic | spell.impact.psychic-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): dark_spell_cast_energy_wave_02.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.radiant | spell.impact.radiant-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): Holy_spell_wave_cast_01.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.slashing | spell.impact.slashing-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): 0009_combat_sword_hit_flesh_c.wav | CC0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.thunder | spell.impact.thunder-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): lighting_spell_electric_impact_thunder_loud_dark_01.ogg | CC BY 4.0 | trimmed, at most 1.9 s, faded, normalised -1 dBFS, mp3 64k |
| spell.loop.acid | spell.loop.acid-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): Drips_Cave_Cavern_2B.wav | CC0 | cut 6.2 s from 21 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.cold | spell.loop.cold-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): Desert_KalNight_.wav | CC0 | cut 6.2 s from 31 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.explosion | spell.loop.explosion-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): earth_spell_cast_meteor_explosion_04.ogg | CC BY 4.0 | cut 6.2 s from 3 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.fire | spell.loop.fire-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): fire_spell_long_soft_01.ogg | CC BY 4.0 | cut 6.2 s from 2.5 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.force | spell.loop.force-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): dark_spell_cast_force_energy_field_01.ogg | CC BY 4.0 | cut 6.2 s from 3 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.lightning | spell.loop.lightning-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): lighting_spell_electric_loop_static_warm_02.ogg | CC BY 4.0 | cut 6.2 s from 2 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.necrotic | spell.loop.necrotic-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): Cave_Ambience_Creepy.wav | CC0 | cut 6.2 s from 21 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.poison | spell.loop.poison-1.mp3 | Fantasy Ambient Sound Effects Pack by kmontesdev (https://kmontesdev.itch.io/fantasy-ambient-sound-effects-pack-cc0): Cave_Ambience_Drips.wav | CC0 | cut 6.2 s from 31 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.psychic | spell.loop.psychic-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): dark_spell_cast_force_energy_field_03.ogg | CC BY 4.0 | cut 6.2 s from 1.3 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.radiant | spell.loop.radiant-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): Holy_spell_heal_cast_long_07.ogg | CC BY 4.0 | cut 6.2 s from 2.5 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| spell.loop.thunder | spell.loop.thunder-1.mp3 | Magic Spell SFX by Leonardo Calvo (The Sound Rack) (https://thesoundrack.itch.io/freemagicspellsfx): earth_spell_cast_earthquake_power_03.ogg | CC BY 4.0 | cut 6.2 s from 3 s, last 0.2 s folded into the first; DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| water.ripples | water.ripples-1.mp3 | own: synth.mjs water-ripples | own | DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| water.flow | water.flow-1.mp3 | own: synth.mjs water-flow | own | DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| water.waves | water.waves-1.mp3 | own: synth.mjs water-waves | own | DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| water.still | water.still-1.mp3 | own: synth.mjs water-still | own | DC removed, seamless loop, normalised -1 dBFS, mp3 48k |
| condition.charmed | condition.applied-1.mp3 | same file as condition.applied (not stored twice) | CC BY 4.0 | none |
| condition.exhaustion | condition.applied-1.mp3 | same file as condition.applied (not stored twice) | CC BY 4.0 | none |
| condition.grappled | condition.restrained-1.mp3 | same file as condition.restrained (not stored twice) | CC0 | none |
| condition.unconscious | condition.prone-1.mp3 | same file as condition.prone (not stored twice) | CC0 | none |
| spell.impact.explosion | spell.impact.fire-1.mp3 | same file as spell.impact.fire (not stored twice) | CC BY 4.0 | none |
| spell.loop.plain | spell.loop.force-1.mp3 | same file as spell.loop.force (not stored twice) | CC BY 4.0 | none |
