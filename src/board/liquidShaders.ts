/**
 * The shader pieces lava and acid add to the painted water's surface (`waterSurface.ts`), chosen by its `LIQUID`
 * define (0 water, 1 lava, 2 acid). Each piece sets what the water's own does, by the same names, so the chunks
 * after it (normal, sky, transmission) read either:
 *
 * - Lava: opaque. Plates of cooled crust (a cellular pattern, warped and drifting with the motion: crusted, churning,
 *   flowing along its direction, surging in hot waves) over molten rock glowing in the tint through the cracks; hotter
 *   and more molten away from the shore, the crust thicker at the edge. The glow is emitted (`lavaGlow`), the crust is
 *   rough dark rock catching the light.
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

/** Lava's body, in the place of the water's: sets `waterWet`, `waterDepth`, `waterP`, `waterT`, `waterSlope`, `waterFoam`, `lavaGlow`, `lavaCrust`. */
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
  float lavaEdge = lavaCracks(lavaQ);
  float lavaFine = lavaCracks(lavaQ * 2.7 + 11.3);
  // Hotter away from the shore; a surge sends hot waves through it.
  float lavaHeat = mix(0.12, 0.6, waterDepth);
  if (uWaterKind == 3) lavaHeat += 0.25 * smoothstep(0.3, 1.0, sin(dot(waterP, uWaterDir) * 0.7 - waterT * (0.6 + uWaterAmount * 1.4)));
  float lavaWobble = waterFbm(waterP * 0.6, vec2(0.3, -0.2), lavaPace * 3.0);
  // Thin glowing cracks between the plates, finer seams across the hotter ones, and now and then an open pool.
  float lavaCrack = 1.0 - smoothstep(0.012, 0.03 + 0.06 * lavaHeat, lavaEdge);
  float lavaSeam = (1.0 - smoothstep(0.008, 0.025, lavaFine)) * 0.35 * smoothstep(0.3, 0.7, lavaHeat);
  float lavaPool = smoothstep(0.74, 0.8, lavaHeat * 0.6 + lavaWobble * 0.55 + 0.25) * 0.9;
  float lavaMolten = clamp(max(max(lavaCrack, lavaSeam), lavaPool), 0.0, 1.0);
  float lavaCrust = 1.0 - lavaMolten;
  // The crust: dark basalt in plates of their own shade, its edges smouldering where the cracks are hot.
  float lavaPlate = waterHash(floor(lavaQ + 0.5));
  vec3 lavaRock = mix(vec3(0.035, 0.03, 0.028), vec3(0.085, 0.07, 0.062), smoothstep(0.25, 0.9, waterNoise(lavaQ * 3.1) * 0.7 + lavaPlate * 0.3));
  lavaRock += uWaterTint * (0.18 * (1.0 - smoothstep(0.0, 0.14, lavaEdge)) + 0.03) * (0.4 + lavaHeat);
  // Molten rock in the tint, yellowing only where it is hottest.
  vec3 lavaHot = mix(uWaterTint, vec3(1.0, 0.78, 0.35), 0.08 + 0.35 * lavaMolten * lavaHeat);
  float lavaFlicker = 0.85 + 0.15 * waterNoise(waterP * 0.5 + waterT * 0.7);
  vec3 lavaGlow = lavaHot * lavaMolten * (0.45 + 1.1 * lavaHeat) * lavaFlicker * waterWet;
  // The crust's relief bends the normal; the molten rock is smooth.
  float lavaE = 0.04;
  float lavaH = waterFbm(lavaQ * 1.6, vec2(0.0), 0.0);
  vec2 waterSlope = vec2(waterFbm((lavaQ + vec2(lavaE, 0.0)) * 1.6, vec2(0.0), 0.0) - lavaH, waterFbm((lavaQ + vec2(0.0, lavaE)) * 1.6, vec2(0.0), 0.0) - lavaH) / lavaE * 0.25 * lavaCrust;
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
