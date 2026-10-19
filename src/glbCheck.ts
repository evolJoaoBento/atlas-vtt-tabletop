/** Checks on a GLB's own header and JSON, before three.js reads it. Pure, so it is tested without a browser. */

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/**
 * Refuses a GLB Tabletop cannot show the same everywhere: one that is not a GLB, uses mesh compression (whose decoders
 * the players' page may not run), or links to files outside itself (which would be fetched from wherever they point).
 */
export function checkGlb(data: ArrayBuffer): void {
  const view = new DataView(data);
  if (data.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) throw new Error('bad magic: not a GLB');
  const length = view.getUint32(12, true);
  let json: { extensionsUsed?: unknown; buffers?: Array<{ uri?: unknown }>; images?: Array<{ uri?: unknown }> };
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, Math.min(length, data.byteLength - 20))));
  } catch {
    throw new Error('bad json: not a GLB');
  }
  const used = Array.isArray(json.extensionsUsed) ? json.extensionsUsed.map(String) : [];
  if (used.some((name) => /draco|meshopt/i.test(name))) throw new Error('compressed with Draco or Meshopt');
  const links = [...(json.buffers ?? []), ...(json.images ?? [])].some((entry) => typeof entry?.uri === 'string' && !/^data:/i.test(entry.uri));
  if (links) throw new Error('it links to files outside itself. Export it as a single self-contained .glb.');
}
