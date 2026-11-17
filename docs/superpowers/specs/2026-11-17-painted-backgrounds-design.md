# Painted backgrounds: design

Date: 2026-11-17. Status: proposed, waiting for the user's approval.

## Intent

The Ground panel offers a handful of fixed backgrounds round a map (a plane with one noise pattern and one material,
or water, lava or acid to the horizon). The GM wants to paint a landscape instead: a 2D picture that says, place by
place, what the ground is (a liquid, a kind of hills, a pattern of their own, or a height they painted) and what it is
made of, saved in a gallery and used again on any map. The editor is a tab of the gallery, renamed Tabletop Gallery.

## What the user decided (2026-11-17)

- **Placement.** The map lies in the middle. The painted picture covers the most the board ever shows round a map: out
  to where the thinnest fog (80) hides everything, a little past it (`planeReach(80, span)` from the map's middle, about
  9.2 times the map's longer side each way). It scales with the map's size. The usable board (map and extra board)
  stays level and the painted ground eases in past its edge, as the horizon plane does now (`EASE_SQUARES`).
- **Topography** is a grayscale height picture (black low, white high), painted with a brush or imported from a file.
- **Custom noise**: a few named patterns per background (up to 4), each with its own settings.
- **Players** see the painted background too (Connect sends its pictures as assets, as it does materials).

## Goals

1. A **Backgrounds** tab in the gallery (view renamed *Tabletop Gallery*, command and ribbon *Open Tabletop Gallery*):
   saved backgrounds as cards with a thumbnail (new, duplicate, rename, delete), and an editor for the one picked.
2. Three painted layers, each shown on the canvas in its own colours (one visible at a time, the others faint):
   - **Terrain**: plains (flat), gentle hills, rolling hills, rough ground, dunes, custom pattern 1–4, painted
     topography, water, lava, acid.
   - **Material** (where the terrain is no liquid): plain ground or one of up to 4 gallery materials picked for the
     background.
   - **Height**: the grayscale topography, read where the terrain is *painted topography*.
3. Tools: brush (size, soft edge), eraser (back to plains / plain ground / mid grey), bucket fill, height value
   slider and heightmap import. Undo and redo in the editor. The middle shows the map's footprint (a rectangle, for
   reference; the map's own size varies, so it is drawn for a square map).
4. Per background: each custom pattern's settings (name, scale in squares, height in squares, roughness 1–6
   octaves, shape smooth / ridged / terraced / craters); the topography's height range in squares; and each liquid's
   motion and tint (the same settings, presets and lava types as the Ground panel).
5. The Ground panel gets a sixth background, **Painted**, with a picker of the saved backgrounds. Fog, extra board
   and the rest stay as they are.
6. The board draws it: the plane's heights from the terrain (each type its pattern, blended softly across borders),
   its materials blended per place, and water, lava and acid as their sheets over the places painted with them (their
   bed lowered under them). Past the picture's edge, its edge continues to the horizon.
7. Players' boards draw the same, from what Connect sends.

## Non-goals

- No 3D preview inside the editor (the GM sees it on the board, which follows a saved change at once).
- No per-map nudging of where the map lies on the picture (the map is always in the middle).
- No layers beyond the three; no painting of props, trees or roads.
- Atlas knows nothing of painted backgrounds: they are Tabletop's own files (Atlas has no such data to defer to).

## Storage

A background is a folder under `atlas-vtt/assets/backgrounds/<name>/` (beside the materials):

- `background.json`: `{ v: 1, name, patterns: [{ name, scale, height, roughness, shape }], materials: [folder…],
  height: { low, high }, liquids: { water, lava, acid } }` (motions as `WaterMotion`).
- `terrain.png`, `material.png`: 2048 × 2048, one index a pixel (red channel), drawn with the editor's palette.
- `height.png`: 2048 × 2048 grayscale.
- `thumb.png`: a small coloured picture of the terrain for the cards.

A map's ground keeps `mode: 'painted'` and `background: <folder>`. The files are ordinary vault files, so sync tools
carry them and Connect can send them.

## Drawing it on the board

- The plane's geometry (`groundPlane.ts`) samples heights from the terrain picture: each terrain type's height at
  that place (its pattern, as `groundHeight` does for one), blended over a few squares at borders, the usable board
  level and the ease past it as now. The grid stays one mesh; its reach is the picture's.
- Materials: a splat shader over up to four gallery materials (colour and normal maps; their roughness as a number)
  weighted by the material picture, softly blended; plain ground where none.
- Liquids: one `WaterSurface` sheet per liquid present, its mask the terrain picture's pixels of that liquid, laid at
  0 with the ground under it lowered to a bed, each with the background's motion and tint (lava's glow, acid's
  bubbles as painted liquids have them). No Atlas glow lights for these (they are no Atlas liquids).

## Connect

`BoardGround` gains `mode: 'painted'` and `painted: { terrain, material, height: asset ids; settings }` with the
background's materials by asset id. Older players read an unknown mode as the map board.

## Calls made by Claude (2026-11-17, after the builder check; the user may overrule)

1. **Resolution: 2048 × 2048** for every layer. The picture spans about 18.5 map-lengths, so a 30-square map gets
   about 3.7 pixels a square near the table, and borders and shores are under a square wide. That is coarse far
   out, which is what the far ground needs. No warped or inset mapping: the editor paints what it shows.
2. **The picture's extent is fixed at the fog-80 reach** (`planeReach(80, span)` from the map's middle), whatever the
   fog is set to. Thicker fog shows less of it. With no fog the plane runs further, and the picture's edge pixels
   continue outward. Patterns, heights and blend widths are in squares, so a hill is the same size on every map;
   only the painted regions scale with the map.
3. **Under the usable board** (map plus extra board) the ground stays level and plain. Painted heights, materials
   and liquids start past its edge and ease in over `EASE_SQUARES`, as the horizon plane does now. A liquid painted
   up to the board stops at its edge. The editor shades the middle as the map, drawn as a square of the map's longer
   side, and painting there has no effect on the board.
4. **Liquids** reuse `WaterSurface` with a picture-sized mask, as the sea plane does now (its texel follows the
   area). One sheet per liquid; each place is one terrain, so liquids never overlap. The ground under a liquid sinks
   to a bed 2.5 squares down, blended into its neighbours over a few squares.
5. **In Painted mode** the Ground panel's own material, pattern and strength rows are hidden. Tile size, fog and
   extra board stay. "Plain ground" is the plane's plain colour. Atlas's own liquids on the map are drawn as before.
   The painted ones are Tabletop's, so they get no Atlas lights.
6. **Height** is read only where the terrain is *painted topography*. Its range is the background's `low` to `high`
   in squares (defaults -2 and 6; black is `low`, white is `high`), eased into the board's edge like the patterns.
7. **Connect** sends the PNGs as vault assets, byte for byte (lossless, so indices survive), plus the settings JSON
   and the materials by asset id. `mode: 'painted'` joins the modes Connect accepts. A player board that does not
   know it falls back to the map board.

## Open to the builder

Palette colours, the exact blend widths, the splat shader's details, the thumbnail's look, the brush's feel.
