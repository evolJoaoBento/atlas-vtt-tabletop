# Board sound sources

Every file here is either from Kenney's CC0 packs (https://kenney.nl, public domain dedication, no attribution needed)
or synthesised for this project (licence "own"). Nothing else is used. Rebuild with:

    node scripts/sounds/fetch-kenney.mjs && node scripts/sounds/synth.mjs && node scripts/sounds/build-sounds.mjs

| Sound id | File | Origin | Licence | What changed |
| --- | --- | --- | --- | --- |
| dice.hit | dice.hit-1.mp3 | Kenney Impact Sounds: impactWood_light_000.ogg | CC0 | pitch +4 st; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-2.mp3 | Kenney Impact Sounds: impactWood_light_001.ogg | CC0 | pitch +5 st; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-3.mp3 | Kenney Impact Sounds: impactWood_light_002.ogg | CC0 | pitch +6 st; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-4.mp3 | Kenney Impact Sounds: impactWood_light_003.ogg | CC0 | pitch +7 st; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-5.mp3 | Kenney Impact Sounds: impactWood_light_004.ogg | CC0 | pitch +8 st; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-6.mp3 | Kenney Impact Sounds: impactWood_light_000.ogg + Kenney Impact Sounds: impactPlate_light_000.ogg | CC0 | pitch +7 st, +9 st; layered; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-7.mp3 | Kenney Impact Sounds: impactWood_light_001.ogg + Kenney Impact Sounds: impactPlate_light_001.ogg | CC0 | pitch +7 st, +9 st; layered; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.hit | dice.hit-8.mp3 | Kenney Impact Sounds: impactWood_light_002.ogg + Kenney Impact Sounds: impactPlate_light_002.ogg | CC0 | pitch +7 st, +9 st; layered; trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.roll | dice.roll-1.mp3 | own: synth.mjs dice-roll | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| dice.caught | dice.caught-1.mp3 | Kenney Interface Sounds: error_001.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| dice.caught | dice.caught-2.mp3 | Kenney Interface Sounds: error_004.ogg | CC0 | pitch -2 st; trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-1.mp3 | Kenney RPG Audio: cloth1.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-2.mp3 | Kenney RPG Audio: cloth2.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-3.mp3 | Kenney RPG Audio: cloth3.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-4.mp3 | Kenney RPG Audio: cloth4.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.pickup | mini.pickup-5.mp3 | Kenney RPG Audio: handleSmallLeather.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-1.mp3 | Kenney RPG Audio: bookPlace1.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-2.mp3 | Kenney RPG Audio: bookPlace2.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-3.mp3 | Kenney RPG Audio: bookPlace3.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-4.mp3 | Kenney Impact Sounds: impactSoft_medium_000.ogg + Kenney Impact Sounds: impactWood_light_001.ogg | CC0 | layered; trimmed, faded, normalised -1 dBFS, mp3 64k |
| mini.putdown | mini.putdown-5.mp3 | Kenney Impact Sounds: impactSoft_medium_001.ogg + Kenney Impact Sounds: impactWood_light_002.ogg | CC0 | pitch -2 st, -2 st; layered; trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.open | door.open-1.mp3 | Kenney RPG Audio: doorOpen_1.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.open | door.open-2.mp3 | Kenney RPG Audio: doorOpen_2.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.shut | door.shut-1.mp3 | Kenney RPG Audio: doorClose_1.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.shut | door.shut-2.mp3 | Kenney RPG Audio: doorClose_2.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.shut | door.shut-3.mp3 | Kenney RPG Audio: doorClose_3.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.locked | door.locked-1.mp3 | Kenney RPG Audio: metalClick.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| door.locked | door.locked-2.mp3 | Kenney RPG Audio: metalLatch.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| wall.crumble | wall.crumble-1.mp3 | own: synth.mjs crumble | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| fog.chime | fog.chime-1.mp3 | Kenney Interface Sounds: confirmation_001.ogg | CC0 | trimmed, faded, normalised -1 dBFS, mp3 64k |
| fog.chime | fog.chime-2.mp3 | Kenney Interface Sounds: glass_001.ogg | CC0 | pitch +3 st; trimmed, faded, normalised -1 dBFS, mp3 64k |
| turn.horn | turn.horn-1.mp3 | own: synth.mjs horn | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.blinded | condition.blinded-1.mp3 | own: synth.mjs condition-blinded | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.charmed | condition.charmed-1.mp3 | own: synth.mjs condition-charmed | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.deafened | condition.deafened-1.mp3 | own: synth.mjs condition-deafened | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.exhaustion | condition.exhaustion-1.mp3 | own: synth.mjs condition-exhaustion | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.frightened | condition.frightened-1.mp3 | own: synth.mjs condition-frightened | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.grappled | condition.grappled-1.mp3 | own: synth.mjs condition-grappled | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.incapacitated | condition.incapacitated-1.mp3 | own: synth.mjs condition-incapacitated | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.invisible | condition.invisible-1.mp3 | own: synth.mjs condition-invisible | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.paralyzed | condition.paralyzed-1.mp3 | own: synth.mjs condition-paralyzed | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.petrified | condition.petrified-1.mp3 | own: synth.mjs condition-petrified | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.poisoned | condition.poisoned-1.mp3 | own: synth.mjs condition-poisoned | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.prone | condition.prone-1.mp3 | own: synth.mjs condition-prone | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.restrained | condition.restrained-1.mp3 | own: synth.mjs condition-restrained | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.stunned | condition.stunned-1.mp3 | own: synth.mjs condition-stunned | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.unconscious | condition.unconscious-1.mp3 | own: synth.mjs condition-unconscious | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| condition.applied | condition.applied-1.mp3 | own: synth.mjs condition-applied | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.acid | spell.impact.acid-1.mp3 | own: synth.mjs spell-impact-acid | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.bludgeoning | spell.impact.bludgeoning-1.mp3 | own: synth.mjs spell-impact-bludgeoning | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.cold | spell.impact.cold-1.mp3 | own: synth.mjs spell-impact-cold | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.explosion | spell.impact.explosion-1.mp3 | own: synth.mjs spell-impact-explosion | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.fire | spell.impact.fire-1.mp3 | own: synth.mjs spell-impact-fire | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.force | spell.impact.force-1.mp3 | own: synth.mjs spell-impact-force | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.lightning | spell.impact.lightning-1.mp3 | own: synth.mjs spell-impact-lightning | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.necrotic | spell.impact.necrotic-1.mp3 | own: synth.mjs spell-impact-necrotic | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.piercing | spell.impact.piercing-1.mp3 | own: synth.mjs spell-impact-piercing | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.poison | spell.impact.poison-1.mp3 | own: synth.mjs spell-impact-poison | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.psychic | spell.impact.psychic-1.mp3 | own: synth.mjs spell-impact-psychic | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.radiant | spell.impact.radiant-1.mp3 | own: synth.mjs spell-impact-radiant | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.slashing | spell.impact.slashing-1.mp3 | own: synth.mjs spell-impact-slashing | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.thunder | spell.impact.thunder-1.mp3 | own: synth.mjs spell-impact-thunder | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.impact.plain | spell.impact.plain-1.mp3 | own: synth.mjs spell-impact-plain | own | trimmed, faded, normalised -1 dBFS, mp3 64k |
| spell.loop.acid | spell.loop.acid-1.mp3 | own: synth.mjs spell-loop-acid | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.bludgeoning | spell.loop.bludgeoning-1.mp3 | own: synth.mjs spell-loop-bludgeoning | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.cold | spell.loop.cold-1.mp3 | own: synth.mjs spell-loop-cold | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.explosion | spell.loop.explosion-1.mp3 | own: synth.mjs spell-loop-explosion | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.fire | spell.loop.fire-1.mp3 | own: synth.mjs spell-loop-fire | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.force | spell.loop.force-1.mp3 | own: synth.mjs spell-loop-force | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.lightning | spell.loop.lightning-1.mp3 | own: synth.mjs spell-loop-lightning | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.necrotic | spell.loop.necrotic-1.mp3 | own: synth.mjs spell-loop-necrotic | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.piercing | spell.loop.piercing-1.mp3 | own: synth.mjs spell-loop-piercing | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.poison | spell.loop.poison-1.mp3 | own: synth.mjs spell-loop-poison | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.psychic | spell.loop.psychic-1.mp3 | own: synth.mjs spell-loop-psychic | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.radiant | spell.loop.radiant-1.mp3 | own: synth.mjs spell-loop-radiant | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.slashing | spell.loop.slashing-1.mp3 | own: synth.mjs spell-loop-slashing | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.thunder | spell.loop.thunder-1.mp3 | own: synth.mjs spell-loop-thunder | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| spell.loop.plain | spell.loop.plain-1.mp3 | own: synth.mjs spell-loop-plain | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| water.ripples | water.ripples-1.mp3 | own: synth.mjs water-ripples | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| water.flow | water.flow-1.mp3 | own: synth.mjs water-flow | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| water.waves | water.waves-1.mp3 | own: synth.mjs water-waves | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
| water.still | water.still-1.mp3 | own: synth.mjs water-still | own | DC removed, crossfaded loop, normalised -1 dBFS, mp3 48k |
