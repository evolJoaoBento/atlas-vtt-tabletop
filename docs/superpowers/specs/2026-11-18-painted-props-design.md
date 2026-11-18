# Painted props: design

Date: 2026-11-18. Builds on `2026-11-17-painted-backgrounds-design.md` (painted backgrounds).

## Intent

Painted backgrounds give the ground round a map its shape, material and liquids. The GM also wants things standing
on it: forests above all, and props in the distance (rocks, ruins, houses). A fourth painting tab, **Props**, paints
where prop brushes scatter their props; the board draws thousands of them cheaply.

## What the user decided (2026-11-18)

- **Density** is a number input (not a slider): props per 10×10 squares. **Scale** is a number input too.
- A **prop brush** holds up to 4 props (picked at random per placement), its density and its scale. Up to 6 brushes
  per background.
- A painted spot smaller than one prop at its scale gets exactly one prop, at the spot's middle.
- Props may stand anywhere but on the map itself (the extra board too; they are decorative, minis pass through).
- Players see them too (Connect).
- Performance: each model is loaded once and repeated (instancing); props on the outer two thirds of the background
  area are drawn as flat pictures of the model (impostors). (2026-11-18: the user moved the line in from the outer half.)

## Goals

1. Editor: a **Props** layer tab beside Terrain / Material / Height. Its palette lists the background's brushes (up to
   6, each with its own colour); a brush has a name, up to 4 props picked from the gallery's props, a **Density**
   number input (props per 10×10 squares, 0.1–200) and a **Scale** number input (0.1–20, the gallery prop's own size
   × scale). Brush, eraser and fill paint the brush's number into a props layer (0 = none).
2. Placement (pure, deterministic): for each brush, its painted cells are split into joined spots (4-connected). A spot
   whose area is under the footprint of its largest prop at the brush's scale gets one prop at its middle. Larger spots
   get props on a jittered grid with spacing `10 / sqrt(density)` squares, each a random prop of the brush, a random
   turn and a size within ±15 % of the scale. No prop on the map itself, none on a liquid. Positions in squares, the
   ground's height from the painted heights. The same picture always gives the same props.
3. Drawing: props within the inner third of the background area (from the map's middle, a third of the picture's
   half-width) are the models themselves, instanced: one `InstancedMesh` per mesh of each model. Props on the outer two
   thirds are
   impostors: two crossed quads with a picture of the model rendered once from the side (alpha-tested). Caps: 6 000
   models and 60 000 impostors per board, thinned evenly (deterministically) when a background asks for more.
   Instanced props receive shadows and do not cast them (cost).
4. Players get the props layer and the brushes (models as asset ids) through Connect and draw the same.

## Storage

- `background.json` gains `props: [{ name, props: [vault path of a .glb, …≤4], density, scale }]` (≤6).
- `props.png`: 2048 × 2048 index layer (as terrain.png), 0 none, 1..6 a brush. Missing → empty.

## Non-goals

- No collision or standing on props; no props in Atlas (they are Tabletop's background, not Atlas props).
- No per-prop editing (move/delete a single tree); paint and erase only.
- No wind animation.

## Calls made by Claude

1. Impostor = two crossed quads (cheap, no billboard shader), one 256 px picture per model, lit flat (a little shade
   from the scene's light colour), fogged as the plane is.
2. The cap thinning keeps every Nth placement by a hash, so density stays even, not cut at one side.
3. A prop's footprint for the single-prop rule = (gallery footprint × scale)² in squares; its size comes from the
   loaded model (the board passes it in), so placement waits for the models.
4. Props stand on the painted height at their foot; on the extra board (level) at 0.
