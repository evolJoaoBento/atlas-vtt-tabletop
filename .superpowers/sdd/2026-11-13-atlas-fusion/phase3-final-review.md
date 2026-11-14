# Atlas fusion Phase 3: final whole-branch review

One fresh reviewer (most capable model), read-only, over both repos: Tabletop `29c5d86..f9d6b4d`, Connect
`45d1f51..e4e9e31`, with the plan, the spec, the ledger's rulings and the plan's Review Focus. Verdict: **ready to
merge with fixes**. One fix pass followed (Tabletop `c69df6e`, Connect `f34a54a`, vendor `d1d436b`); each fix has a test
that failed first, named in `phase3-ledger.md`.

## Strengths the reviewer confirmed

- The converter's round trip is sound for every shape, cast from the caster or at a point, level or pitched (errors ≤ 1e-16).
- The reconciler touches only walls whose `chainId` begins `spell:` and features with `tabletop.spell`; its comparison is a
  fixed point against Atlas's real `addWall` and `addMapFeatures`.
- Ownership is stamped by the GM only; the temporary sweep touches only `temp` measures.
- The projection to players is a real allowlist (`hidden`, `origin`, `light`, `by`, `level` and unknown `tabletop` keys
  never leave; an unreadable origin fails closed).
- The contract matches on both sides (`overlay()`, `flashSpell`, the `spell` mark, `FUSION_PROTOCOL = 3`).
- No replay path found for Review Focus 5 (open, level switch, re-read); the reconciler cannot run against the wrong map
  or loop; two boards on one map converge.

## Findings and what was done

| # | Finding | Done |
|---|---|---|
| C1 | Hidden measures (and ones that started on a token players did not see) were drawn in the GM's local player window | Fixed: marked GM-only and left out of the players' picture |
| I1 | A spell made to follow a token in Atlas stayed behind in 3D, with its walls and ground | Fixed: a measure that follows a token lies around that token, on the GM's board, the players' views and in what the spell stands; plain auras are drawn the same way |
| I2 | A spell removed while no board is open left its walls and ground in Atlas | Fixed: a plugin-level upkeep of every open Atlas map removes orphans; making stays the open board's |
| I3 | Players' spells and templates landed on the floor the GM browses | Fixed: stamped with the level the players are shown |
| I4 | A player at a limit saw nothing happen | Fixed: the reason's own words on the 2D page and the 3D board |
| I5 | An Atlas-made area with an effect plays no sound in 3D (plan D3) | Not built; the cut is recorded in spec section 10 |
| m1 | A spell's light written with `animation` as an object | Fixed (`'none'`) |
| m2 | `spellToMeasure` threw on a spell of no size (a crafted cast could throw in the GM's handler) | Fixed |
| m3, m7 | An unreadable spell drawn nowhere; `record.id` taken over the record's key | Fixed |
| m4 | Stretching a wall or column in Atlas makes it taller | Deferred; in spec section 10 |
| m5 | A refusal shown seconds after an instantaneous cast on a map not held | Fixed |
| m6 | A projected owner longer than the scene's own check allows | Fixed |
| m8 | Connect's upkeep covers only the shown map, not a split party's others | Deferred |
| m9 | Players' measures are steps of the GM's undo | Deferred |
| m10 | `templateWrite`'s clear is unreachable on the GM's board | Deferred |

Declined to judge by the reviewer, ruled in the ledger: a GM flash's `caster` and `rules.summon.statblock` reach players
(both as before this branch); a rebuilt board showed no measures (fixed); an effect changed in Atlas does not change the
3D look (D1); the scene's limit counts the GM's spells too (as the spec states).

Rulings the reviewer would overturn: silent `limit`/`full` (overturned, I4); the reconciler only from an open board
(overturned for orphan removal, I2); auras not drawn (overturned for all following measures, I1); sizes scaling with the
points' distance for a wall's and a column's height (kept; deferred minor m4).
