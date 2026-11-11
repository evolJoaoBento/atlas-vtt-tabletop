// Pulls the ids of Atlas's toolbar tools, command palette entries and asset manager tabs out of a built Atlas main.js.
// Pure; used by check-atlas-members.mjs and the tests. The anchors are the minified shapes of Atlas 0.12.0's catalogs.

/** @param {string} source  @returns {{ toolbar: string[], palette: string[], assetTabs: string[] }} */
export function extractAtlasIds(source) {
  // Toolbar catalog units: `{id:"loot",label:…,hotkey:"lootRoller",dmOnly:!0,hideable:!0,…}`, the undo unit included.
  const toolbar = unique([...source.matchAll(/\{id:"([a-zA-Z]+)",label:[^{}]*?,hotkey:"[^"]*",dmOnly:![01],hideable:/g)].map((m) => m[1]));
  // Palette entries: `{id:"open-loot-roller",icon:…` from the first tool entry to the section tabs, then the toolbar editor entry.
  const start = source.indexOf('{id:"move-tool",icon:');
  const end = start < 0 ? -1 : source.indexOf('palette.tab.all', start);
  const entries = start < 0 || end < 0 ? '' : source.slice(start, end);
  const palette = unique([...entries.matchAll(/\{id:"([a-z0-9-]+)",icon:/g)].map((m) => m[1]));
  if (palette.length > 0 && /\{id:"customize-toolbar",icon:/.test(source)) palette.push('customize-toolbar');
  // Asset manager tabs: the array of tab ids right before their labels (`am.tab.<id>`).
  const tabs = /=\[((?:"[a-z]+",?)+)\],\w+=\{scenes:\w+\("am\.tab\.scenes"\)/.exec(source);
  const assetTabs = tabs ? [...tabs[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]) : [];
  return { toolbar, palette, assetTabs };
}

/** @param {readonly string[]} found  @param {readonly string[]} listed */
export function compareIds(found, listed) {
  return { unlisted: found.filter((id) => !listed.includes(id)), gone: listed.filter((id) => !found.includes(id)) };
}

function unique(ids) { return [...new Set(ids)]; }
