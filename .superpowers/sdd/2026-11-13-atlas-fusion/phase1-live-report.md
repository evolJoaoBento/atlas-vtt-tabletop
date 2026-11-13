# Atlas fusion Phase 1: live check on Atlas VTT 0.15.0

Run 2026-11-13 on real Obsidian, in the throwaway vault `C:\Users\joaoo\fusion-gate-vault` (profile `fusion`, DevTools
port 9311), by `harness/live/phase1.cjs`. Builds under test: Tabletop 1.4.0 (`feat/atlas-fusion`) and Connect 0.10.0
(`feat/atlas-fusion`), both at fusion protocol 1, on stock Atlas 0.15.0. No real vault was touched.

**Result: 16 of 16 scripted steps pass.** Evidence for every step is in `phase1-live/results.json`; the console of the
run is in `phase1-live/console.json`; screenshots are beside them.

## Steps

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Versions and pairing | pass | Atlas 0.15.0, Tabletop 1.4.0, Connect 0.10.0; `api.fusion === 1`; no pairing notice |
| 2 | No asset-service error | pass | no "Initializing asset service failed" after a board and an Atlas view were up |
| 3 | Host from nothing | pass | 0 Atlas tabs before; 1 after, hidden (`offsetParent === null`); the board stayed active; the map held 0.3 s after the board was up; the tab is marked as opened by Tabletop |
| 4 | Follow, and the bar | pass | focusing the Cove board moved Atlas to Cove; the Cellar board read "View only. Atlas holds Probe Cove." with "Edit here"; Edit here brought Atlas back to Cellar, still one Atlas tab, still hidden |
| 5 | Edits | pass | a move on the held board went through Atlas and reached the file in 0.6 s; the same call on the other board was refused with `NotHeldError`, and that map's file was not touched |
| 6 | Popout | pass | with the board in a popout window, the Atlas tab stayed in the main window, no "main window" notice, the popout board stayed active |
| 7 | The user closes Atlas's tab | pass | "Atlas closed this map. Editing is paused." with "Reopen"; Reopen held the map again |
| 8 | Closing | pass | the tab Tabletop opened closed with the last board; an Atlas tab opened by hand stayed after a board opened and closed |
| 9 | Distances | pass | collection set to Manhattan and a custom unit "mi": the board's label over 3 diagonal and 2 straight cells read "8 mi", with no reload asked for |
| 10 | Rooms migration | pass | Atlas turned the three rooms into 10 walls on chain `rooms_`; the height 3 and the material moved to the new wall ids (one of the two edges was stored the other way round); backup of the map (with its rooms) and of Tabletop's data written; notice "moved 2 wall settings to Atlas 0.15's room walls on Fusion Rooms; backup in Tabletop backups/2026-11-13/"; 10 walls drawn, none doubled |
| 11 | Light level | pass | the board's slider set Atlas's `lighting.ambient` to 0.42 in the store and the file; nothing kept in Tabletop's data |
| 12 | Laser and dice | pass | the board's laser colour is Atlas's setting (`#00a9ff` in both); Atlas's dice volume 0.3 gave the board's dice group a gain of 0.3, minis stayed at 1 |
| 13 | Scene tabs | pass | each tab has the label and one button at each end; the presented tab is marked |
| 14 | Pin name | pass | the pin with `showName` carries it on the board |
| 15 | Atlas 0.14 | pass | one "Tabletop needs Atlas VTT 0.15 or later (found 0.14.0)" notice, one from Connect, no API published, the board tab says the same; back on 0.15.0 the API is there again |
| 16 | Console | pass | no error from Tabletop or Connect across the run |

## What the run found and fixed

- **A collection's settings did not reach an open board.** Atlas writes them to a hidden folder a moment after changing
  them, and Obsidian announces nothing for that folder, so the board kept the old units and diagonal rule until it
  reloaded for another reason. The board now reads the rules from Atlas's running service and reads again on Atlas's
  `collection-settings-changed` event (commit "fix(board): read a collection's rules from Atlas's running service…").
  Step 9 passes without asking for a reload.

Two first-run failures were the script's own (a notice listener bound to an old object; listening too late for Connect's
notice at start-up) and were fixed in the script, not the product.

## Left for the user (needs a person, a device or ears)

1. **A web player's refused move.** Join from the player page, and drag your token while the GM's board focus is on
   another map. Expected: the token goes back and the page says "The GM's Atlas is on another map; try again in a moment."
2. **A stale hosted page.** A player page from before this release must be refused with "This table needs the updated
   player page" (an older page shows its own "out of date" wording). This needs the page hosted: still an open item.
3. **Dice at Atlas's volume.** Lower Atlas's Dice volume and throw dice on the board: they should be as quiet.
4. **A minimised or covered Obsidian window.** The run switches off Chromium's background throttling; the hidden Atlas
   tab was not exercised with the window minimised.

## Notes

- Step 14 checks the map model only (the pin's `showName` is read); the label's look is in `step14-pin-name.png`.
- The vault is left on Atlas 0.15.0 with the builds under test. `Tabletop backups/2026-11-13/` in it holds the backups
  the run made.
