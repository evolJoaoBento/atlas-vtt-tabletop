# Atlas fusion 4F: ported panels re-synced from Atlas 0.15 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Atlas panels Tabletop ports (command palette, random tables, loot, asset manager) are copies of Atlas 0.15.0, the floor, not of 0.12.0; what they pull into `src/atlasPort/app/{grid,levels,lighting,vision}` is only what they import.

**Architecture:** `npm run sync:atlas` (`scripts/sync-atlas-port.mjs`, manifest `scripts/atlasPortList.mjs`) re-copies the entries and their imports from `C:\Users\joaoo\2075\atlas-vtt-0.15-ref`; boundaries and patches are brought up to 0.15; the shims follow the members the 0.15 copies call; the parity checker's tables follow 0.15.

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` section 8 "Ported UI", section 9. Inventory: `.superpowers/sdd/2026-11-15-atlas-fusion-phase4f/inventory.md`.

## Global Constraints
- Never push, merge, or touch a real vault; live checks only in the throwaway vault on Atlas 0.16.0 and 0.15.0.
- Copies are verbatim from the 0.15.0 tag but for the manifest's boundaries and patches (the sync fails on a patch whose anchor moved).
- `FUSION_PROTOCOL` stays 4. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions
- **F1 The tag is 0.15.0** (the floor): the panels call into the installed Atlas, which is 0.15 or newer; a 0.16 copy could call what 0.15 lacks. atlas-shared stays at 0.16.0 (pure rules that read 0.15 records).
- **F2 `clipper2-ts` is allowed** (Tabletop already bundles it).
- **F3 The initiative tracker is no `sync:atlas` port** (a hand-written DOM port of Atlas 0.8's, whose writes are store actions since Phase 2); re-porting Atlas's React tracker is out of this sub-plan; section 9 gets the row.
- **F4 The asset manager stays a port**: Atlas's global manager exposes no drop payload or place-on-board path (inventory), the spec's else-branch.
- **F5 The four folders** hold what the 0.15 copies import (more than at 0.12: the asset manager's scene menus); nothing of Tabletop's own code imports them.

## Review Focus
1. Each panel opens and does its main job on the board (palette command, a random table roll, a loot roll kept in history, a token and an encounter spawned onto the board, a scene opened).
2. A command or tab Atlas 0.15 added that the shims do not stand in for: hidden or refused, never a throw.
3. The parity checker against installed Atlas 0.15.0 and 0.16.0 builds.
4. Texts in every language (atlasTextData.ts).

### Task 1: Re-sync at 0.15.0 (implementer)
- Bring `atlasPortList.mjs` to 0.15 (ALLOWED_PACKAGES + clipper2-ts; patches re-anchored; new boundaries for 0.15 imports the shims must stand in for); run `node scripts/sync-atlas-port.mjs ../atlas-vtt-0.15-ref`; make tsc, `npm test`, `npm run build` pass by adapting shims (never by editing copies); `npm run check:atlas` against `C:/Users/joaoo/2075/sound-downloads/atlas-0.15.0/main.js` and `atlas-0.16.0/main.js`; UI harness `random tables|asset manager|command palette|loot`, and the board suite. Commit.

### Task 2: Vendor, live, review
- Vendor cycle; live chains (phase4e) on 0.16 and 0.15 plus a live step 55 (palette, random table, loot, asset manager spawn on the board in Obsidian); spec section 9; one fresh reviewer; one fix pass; records; memory.
