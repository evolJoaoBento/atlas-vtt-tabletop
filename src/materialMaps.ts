/**
 * How a material's texture maps are told apart, by their file names as Poly Haven gives them
 * (`brick_wall_diff_1k.jpg`, `…_nor_gl_1k.jpg`, `…_rough_1k.jpg`, `…_arm_1k.jpg`), and what a material is called. Pure.
 */

export type MapRole = 'color' | 'normal' | 'roughness' | 'ao' | 'arm' | 'metalness';

/** The image formats a map is read from. */
const IMAGE = /\.(jpe?g|png|webp)$/i;

/** The words that name a map, by role; a material's own name may hold them too ("metal_plate"), so the last one counts. */
const ROLE_WORDS: Record<string, MapRole | null> = {
  arm: 'arm',
  nor: 'normal', normal: 'normal', nrm: 'normal', norm: 'normal',
  rough: 'roughness', roughness: 'roughness',
  ao: 'ao', occlusion: 'ao', ambientocclusion: 'ao',
  metal: 'metalness', metallic: 'metalness', metalness: 'metalness',
  diff: 'color', diffuse: 'color', albedo: 'color', basecolor: 'color', col: 'color', color: 'color', colour: 'color',
  // Maps Tabletop does not use.
  disp: null, displacement: null, height: null, bump: null, preview: null, thumb: null, thumbnail: null, mask: null, spec: null, specular: null,
};

/**
 * What a texture file is, by its name: its role (the last map word in it), and for a normal map whether it is
 * DirectX's (green flipped); null for anything else (a displacement map, a preview, a .blend).
 */
export function roleOf(name: string): { role: MapRole; directX: boolean } | null {
  if (!IMAGE.test(name)) return null;
  const words = name.replace(IMAGE, '').toLowerCase().split(/[\s_.-]+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]!;
    if (!(word in ROLE_WORDS)) continue;
    const role = ROLE_WORDS[word]!;
    if (role === null) return null;
    return { role, directX: role === 'normal' && (words.includes('dx') || words.includes('directx')) };
  }
  return null;
}

export interface MaterialMaps {
  color?: string;
  normal?: string;
  /** The normal map is DirectX's: its green is flipped when read. */
  normalDirectX?: boolean;
  roughness?: string;
  ao?: string;
  arm?: string;
  metalness?: string;
}

/** The maps among a material's files: one per role, an OpenGL normal map before a DirectX one. A material needs a colour map. */
export function pickMaps(names: readonly string[]): MaterialMaps | null {
  const maps: MaterialMaps = {};
  for (const name of [...names].sort()) {
    const found = roleOf(name.split('/').pop() ?? name);
    if (!found) continue;
    if (found.role === 'normal') {
      if (maps.normal && (!maps.normalDirectX || found.directX)) continue;
      maps.normal = name;
      maps.normalDirectX = found.directX;
      continue;
    }
    if (!maps[found.role]) maps[found.role] = name;
  }
  if (!maps.normal) delete maps.normalDirectX;
  return maps.color ? maps : null;
}

/** A material's name from its zip or a map's file name: `brick_wall_001_diff_1k.jpg` gives "brick_wall_001". */
export function materialName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const cut = base.toLowerCase().search(/[_-](diff|diffuse|albedo|basecolor|col|color|nor|normal|rough|roughness|ao|arm|disp|metal)([_-]|$)/);
  const name = (cut > 0 ? base.slice(0, cut) : base).replace(/[_-](\d+k)$/i, '');
  return name.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'Material';
}
