# Atlas fusion 4D: sight follows Atlas — live check

Run 2026-11-15 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`, its 0.15 copy put back before each chain),
Obsidian role `fusion` on port 9311, with Tabletop 1.9.0 after the review's fix pass (df889c0, sync 69d8217) and
Connect 0.15.0 (af97127), fusion 4. Script: `ATLAS_BUILD=<build> node harness/live/phase4d.cjs` (it runs 4C's, which
runs 4B, 4A, 3, 2 and 1 first). Results: `phase4d-live/atlas-0.16.0/`, `phase4d-live/atlas-0.15.0/`.

| Phase | Atlas 0.16.0 | Atlas 0.15.0 |
|---|---|---|
| 1 | 16/16 | 16/16 |
| 2 | 6/6 | 6/6 |
| 3 | 10/10 | 10/10 |
| 4A | 6/6 | 6/6 |
| 4B | 8/8 | 8/8 |
| 4C | 10/10 | 10/10 |
| 4D (0, 53, 50) | 3/3 | 3/3 |

## Gates (before the plan)

`harness/live/phase4d-probe.cjs`, on both builds (`.superpowers/sdd/2026-11-14-atlas-fusion-phase4d/probe-*.json`): the
Atlas tab Tabletop hosts hidden behind the board has a lighting controller, is lit and current at once after
`setSceneLighting`, gives sight regions per token, the players' frame perception, and a new sight within a frame of a
token moved through the store, hidden or in front. A light reach carries no colour, so lamps are not drawn from it.

## Step 53

On a dark lit scene (ambient 0), a token with vision of two squares and another token twelve squares off: the board's
players' picture shows the first and not the second, the dark is veiled; the GM's board shows both, unveiled; after a
change of quality that makes the board anew the new board keeps Atlas's sight; the far token moved next to the seer
through Atlas's store shows; lighting off, no veil. It was watched failing on the build before the fix pass at the
rebuild (the new board unlit, the unseen token shown).

## What went wrong on the way

Phase 1's steps 3 and 4 (also the unexplained flake of the 0.16 close) failed whenever the vault's saved layout brought
back a pop-out window: the boards opened there, and the host's Atlas tab, opened by design in the main window, showed.
Step 3 now closes pop-out leaves and focuses the main window first (66be63e). Step 10 failed with them from the copy
and passed once they did.

## Not checked live

- A Connect player session (players' boards draw Connect's darkness fog, unchanged by 4D).
- Preview POV on a lit scene in Obsidian (UI harness only).
- A token dragged over the dark in the GM's player window (UI harness only).
