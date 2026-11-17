/**
 * The shader pieces lava and acid add to the painted water's surface (`waterSurface.ts`), chosen by its `LIQUID`
 * define (0 water, 1 lava, 2 acid). Each piece sets what the water's own does, by the same names, so the chunks
 * after it (normal, sky, transmission) read either:
 *
 * - Lava: opaque, molten rock glowing in the tint (emitted, `lavaGlow`) under or between crust, hotter and more molten
 *   away from the shore; the pattern warps and drifts with the motion (still, churning, flowing along its direction,
 *   surging in hot waves). Its kind (`uLavaStyle`, `water.ts` LAVA_STYLES) is what the crust is like: plates of dark
 *   basalt with glowing cracks (crusted flow); a glossy skin folded into ropes with molten toes breaking out (ropey,
 *   pahoehoe); jagged rusty clinker glowing only deep in its gaps (rubble, a'a); open molten rock with crust rafts and
 *   cooling skin drawn into lines between convection cells (lake); thick bright rock swirling with streaks of slag
 *   (magma).
 * - Acid: the water's see-through body, brighter and less darkened with depth, bubbles rising and popping, a yellowish
 *   scum on its shore and on the bubbles, and a faint glow of its own.
 */

/** GLSL helpers (after the water's own `waterNoise`, `waterFbm`). */
export const LIQUID_HEAD = /* glsl */ `
#if LIQUID == 1
/** How near a point is to the crack between two crust plates (0 on it): F2 - F1 of a cellular pattern. */
float lavaCracks(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(waterHash(i + g), waterHash(i + g + 19.19)) * 0.85 + 0.075;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}
uniform int uLavaStyle;
/** The crust's relief at a point, about -1 to 1, for the kind of lava: ropes, jagged clinker, or rolling crust. */
float lavaRelief(vec2 q) {
  if (uLavaStyle == 1) return sin(q.x * 6.0 + waterNoise(q * 2.0) * 1.5);
  if (uLavaStyle == 2) return waterFbm(q * 3.2, vec2(0.0), 0.0) * 1.4 + (1.0 - smoothstep(0.0, 0.12, lavaCracks(q * 2.2))) * 0.6;
  return waterFbm(q * 1.6, vec2(0.0), 0.0);
}
#endif
#if LIQUID == 2
/** Bubbles in a cell grid: each grows, then pops, at its own pace; 0 none, about 1 on a bubble's rim. */
float acidBubbles(vec2 p, float t, float pace) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float best = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 id = i + g;
      float h = waterHash(id);
      vec2 c = g + vec2(waterHash(id + 1.7), waterHash(id + 4.3)) * 0.8 + 0.1 - f;
      float life = fract(t * pace * (0.5 + h) + h * 7.0);
      float r = (0.06 + 0.26 * h) * smoothstep(0.0, 0.85, life);
      float pop = 1.0 - smoothstep(0.85, 1.0, life);
      float d = length(c);
      float rim = smoothstep(r, r - 0.04, d) * smoothstep(r - 0.12, r - 0.03, d);
      float dome = smoothstep(r, 0.0, d);
      best = max(best, (rim * 0.85 + dome * 0.3) * pop * step(0.45, h + 0.3));
    }
  }
  return best;
}
#endif
`;

/** Lava's body, in the place of the water's: sets `waterWet`, `waterDepth`, `waterP`, `waterT`, `waterSlope`, `waterFoam`, `lavaGlow`, `lavaCrust`, `lavaRough`. */
export const LAVA_BODY = /* glsl */ `
  vec2 waterUv = vec2(vUv.x, 1.0 - vUv.y);
  float waterWet = smoothstep(0.3, 0.7, texture2D(uWaterMask, waterUv).r);
  if (waterWet < 0.01) discard;
  float waterNear = textureLod(uWaterMask, waterUv, uWaterBlur * 0.55).r;
  float waterFar = textureLod(uWaterMask, waterUv, uWaterBlur).r;
  float waterDepth = smoothstep(0.45, 1.0, waterFar * 0.6 + waterNear * 0.4);
  vec2 waterP = waterUv * uWaterCells;
  float waterT = uWaterTime;
  float waterFoam = 0.0;
  // Lava moves slowly: a fraction of the water's pace.
  float lavaPace = waterT * (0.02 + uWaterAmount * 0.12);
  vec2 lavaDrift = uWaterKind == 2 ? uWaterDir * lavaPace * 4.0 : vec2(0.0);
  float lavaChurn = uWaterKind == 0 ? 0.25 : (uWaterKind == 1 ? 1.1 : 0.6);
  vec2 lavaWarp = vec2(waterFbm(waterP * 0.3 + 3.1, vec2(0.6, 0.4), lavaPace), waterFbm(waterP * 0.3 - 5.7, vec2(-0.4, 0.6), lavaPace));
  vec2 lavaQ = waterP * 0.8 - lavaDrift + lavaWarp * lavaChurn * (0.6 + uWaterAmount);
  // Flowing lava stretches its plates along the way it runs.
  if (uWaterKind == 2) { vec2 across = vec2(-uWaterDir.y, uWaterDir.x); lavaQ = vec2(dot(lavaQ, uWaterDir) * 0.55, dot(lavaQ, across) * 1.2); }
  // Hotter away from the shore; a surge sends hot waves through it.
  float lavaHeat = mix(0.12, 0.6, waterDepth);
  if (uWaterKind == 3) lavaHeat += 0.25 * smoothstep(0.3, 1.0, sin(dot(waterP, uWaterDir) * 0.7 - waterT * (0.6 + uWaterAmount * 1.4)));
  float lavaWobble = waterFbm(waterP * 0.6, vec2(0.3, -0.2), lavaPace * 3.0);
  // What each kind of lava makes of it: how molten it is, its crust's colour, relief and roughness, how far the molten rock yellows.
  float lavaMolten = 0.0;
  vec3 lavaRock = vec3(0.05);
  float lavaBump = 0.25;
  float lavaRough = 0.92;
  float lavaHotness = 0.35;
  float lavaShine = 1.0;
  if (uLavaStyle == 1) {
    // Ropey (pahoehoe): ropes folded across the way it runs, bent by a slow wander; molten toes break out at the lobes' edges.
    float bend = waterFbm(lavaQ * 0.45, vec2(0.2, 0.1), lavaPace) * 3.5;
    float ropes = sin(lavaQ.x * 3.2 + bend * 2.0 + waterNoise(lavaQ * 1.5) * 1.2);
    // Molten toes: round lobes breaking out of the skin where it is hot, not lines.
    float lobes = waterFbm(lavaQ * 0.55 + 4.7, vec2(0.1, 0.05), lavaPace * 2.0) * 0.5 + 0.5;
    float toes = smoothstep(0.74, 0.79, lobes + lavaHeat * 0.12);
    float folds = (1.0 - smoothstep(-1.0, -0.88, ropes)) * 0.35 * smoothstep(0.35, 0.7, lavaHeat);
    lavaMolten = max(toes, folds);
    // A glossy dark skin, silvery on the crests of its ropes, glowing faintly at a toe's rim.
    lavaRock = mix(vec3(0.02, 0.018, 0.022), vec3(0.11, 0.1, 0.105), smoothstep(-0.4, 1.0, ropes));
    lavaRock += uWaterTint * 0.25 * smoothstep(0.62, 0.74, lobes + lavaHeat * 0.12) * (1.0 - toes);
    lavaBump = 0.1;
    lavaRough = 0.5;
  } else if (uLavaStyle == 2) {
    // Rubble (a'a): blocks of clinker, rough and rusty, glowing only deep in the gaps where it is hot.
    float block = lavaCracks(lavaQ * 2.2);
    float gap = 1.0 - smoothstep(0.0, 0.035, block);
    lavaMolten = gap * smoothstep(0.2, 0.7, lavaHeat) * 0.8;
    float jag = waterNoise(lavaQ * 9.0) * 0.5 + (1.0 - smoothstep(0.0, 0.1, lavaCracks(lavaQ * 5.3 + 7.7))) * 0.5;
    lavaRock = mix(vec3(0.07, 0.052, 0.042), vec3(0.18, 0.13, 0.095), jag) * (0.7 + 0.6 * waterHash(floor(lavaQ * 2.2 + 0.5)));
    lavaRock += uWaterTint * 0.1 * (1.0 - smoothstep(0.0, 0.12, block)) * lavaHeat;
    lavaBump = 0.45;
    lavaRough = 0.98;
  } else if (uLavaStyle == 3) {
    // Lake: open molten rock; crust rafts drift and break, and cooling skin gathers in lines between the convection cells.
    lavaHeat = max(lavaHeat, 0.5);
    float raft = smoothstep(0.52, 0.6, waterFbm(lavaQ * 0.45 + 2.3, vec2(0.15, -0.1), lavaPace * 2.0) * 0.5 + 0.5);
    float raftCrack = 1.0 - smoothstep(0.01, 0.04, lavaCracks(lavaQ * 1.3));
    float skin = (1.0 - smoothstep(0.0, 0.14, lavaCracks(lavaQ * 0.5 + lavaWarp))) * 0.85;
    lavaMolten = clamp(1.0 - max(raft * (1.0 - raftCrack * 0.9), skin), 0.0, 1.0);
    lavaRock = mix(vec3(0.035, 0.025, 0.022), vec3(0.08, 0.055, 0.045), waterNoise(lavaQ * 3.0)) + uWaterTint * 0.1 * (1.0 - raft);
    lavaBump = 0.15;
    lavaHotness = 0.22;
    lavaShine = 0.5;
  } else if (uLavaStyle == 4) {
    // Magma: thick, slow and very hot; bright rock swirling in bands, dark slag drawn out in streaks.
    lavaHeat = max(lavaHeat, 0.5) + 0.15 * waterDepth;
    vec2 swirl = vec2(waterFbm(lavaQ * 0.35 + 9.1, vec2(0.3, 0.2), lavaPace * 1.5), waterFbm(lavaQ * 0.35 - 4.3, vec2(-0.2, 0.3), lavaPace * 1.5));
    float band = waterFbm(lavaQ * 0.7 + swirl * 2.5, vec2(0.1, 0.05), lavaPace);
    float slag = 1.0 - smoothstep(0.03, 0.12, abs(band));
    lavaMolten = clamp(1.0 - slag * 0.85, 0.0, 1.0) * mix(0.7, 1.0, waterDepth);
    lavaRock = uWaterTint * 0.12 + vec3(0.03, 0.015, 0.01);
    lavaBump = 0.1;
    lavaRough = 0.6;
    lavaHotness = 0.3;
    lavaShine = 0.5;
  } else {
    // Crusted flow: thin glowing cracks between plates, finer seams across the hotter ones, and now and then an open pool.
    float lavaEdge = lavaCracks(lavaQ);
    float lavaFine = lavaCracks(lavaQ * 2.7 + 11.3);
    float lavaCrack = 1.0 - smoothstep(0.012, 0.03 + 0.06 * lavaHeat, lavaEdge);
    float lavaSeam = (1.0 - smoothstep(0.008, 0.025, lavaFine)) * 0.35 * smoothstep(0.3, 0.7, lavaHeat);
    float lavaPool = smoothstep(0.74, 0.8, lavaHeat * 0.6 + lavaWobble * 0.55 + 0.25) * 0.9;
    lavaMolten = max(max(lavaCrack, lavaSeam), lavaPool);
    // Dark basalt in plates of their own shade, the edges smouldering where the cracks are hot.
    float lavaPlate = waterHash(floor(lavaQ + 0.5));
    lavaRock = mix(vec3(0.035, 0.03, 0.028), vec3(0.085, 0.07, 0.062), smoothstep(0.25, 0.9, waterNoise(lavaQ * 3.1) * 0.7 + lavaPlate * 0.3));
    lavaRock += uWaterTint * (0.18 * (1.0 - smoothstep(0.0, 0.14, lavaEdge)) + 0.03) * (0.4 + lavaHeat);
  }
  lavaMolten = clamp(lavaMolten, 0.0, 1.0);
  float lavaCrust = 1.0 - lavaMolten;
  // Molten rock in the tint, yellowing only where it is hottest.
  vec3 lavaHot = mix(uWaterTint, vec3(1.0, 0.78, 0.35), 0.08 + lavaHotness * lavaMolten * lavaHeat);
  float lavaFlicker = 0.85 + 0.15 * waterNoise(waterP * 0.5 + waterT * 0.7);
  vec3 lavaGlow = lavaHot * lavaMolten * (0.45 + 1.1 * lavaHeat) * lavaShine * lavaFlicker * waterWet;
  // The crust's relief bends the normal; the molten rock is smooth.
  float lavaE = 0.04;
  float lavaH = lavaRelief(lavaQ);
  vec2 waterSlope = vec2(lavaRelief(lavaQ + vec2(lavaE, 0.0)) - lavaH, lavaRelief(lavaQ + vec2(0.0, lavaE)) - lavaH) / lavaE * lavaBump * lavaCrust;
  diffuseColor = vec4(mix(lavaHot * 0.25, lavaRock, lavaCrust), waterWet);
`;

/** Lava's emitted glow, after the material's own emission. */
export const LAVA_EMISSION = /* glsl */ `
#include <emissivemap_fragment>
#if LIQUID == 1
  totalEmissiveRadiance += lavaGlow;
#elif LIQUID == 2
  totalEmissiveRadiance += uWaterTint * (0.04 + 0.4 * acidBubble) * diffuseColor.a;
#endif
`;

/** Acid's bubbles and scum over the water's body (after it): sets `acidBubble`. */
export const ACID_BODY = /* glsl */ `
  float acidBubble = acidBubbles(waterP * 0.9 + waterSlope * 3.0, waterT, 0.25 + uWaterAmount * 0.6);
  vec3 acidScum = mix(vec3(0.8, 0.84, 0.4), uWaterTint, 0.45);
  // Murky: bright in the shallows, dark and thick where it is deep.
  vec3 acidBody = uWaterTint * mix(0.8, 0.22, waterDepth);
  // Scum drifting in patches on the surface.
  float acidPatch = smoothstep(0.58, 0.78, waterFbm(waterP * 0.35, vec2(0.05, 0.03), waterT * (0.2 + uWaterAmount * 0.4)) * 0.5 + 0.5) * 0.55;
  waterFoam = clamp(waterFoam + acidBubble * 0.7 + acidPatch, 0.0, 1.0);
  waterSlope += vec2(dFdx(acidBubble), dFdy(acidBubble)) * 0.6;
  diffuseColor = vec4(mix(acidBody, acidScum, waterFoam), waterWet);
`;
