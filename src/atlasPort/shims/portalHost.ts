// Stand-in for Atlas's host/portalHost.ts @ 0.15.0 (AGPL-3.0) in the copies: where their floating UI (tooltips, menus,
// toasts, dialogs) joins a document. Atlas's own copy keeps one host per document and, the first time it makes one,
// removes every other `body > .atlas-portal-host`: run from Tabletop it would remove the running Atlas's host and all
// that is in it (and Atlas would then remove Tabletop's). So the copies join the running Atlas's host when there is one
// (Atlas's stylesheet styles what is in it, the asset manager's tooltips and fields included) and never remove it. Without
// one they get Tabletop's own host, which has another class, so Atlas never takes it for one of its own stale ones.
const ATLAS_HOST = 'atlas-portal-host';
const TABLETOP_HOST = 'atlas-tabletop-portal-host';

const own = new Set<HTMLElement>();

export function portalHost(doc: Document = document): HTMLElement {
  const atlas = doc.body.querySelector<HTMLElement>(`:scope > .${ATLAS_HOST}`);
  if (atlas) return atlas;
  for (const host of own) {
    if (!host.isConnected) own.delete(host);
    else if (host.ownerDocument === doc) return host;
  }
  const host = doc.body.createDiv({ cls: TABLETOP_HOST });
  // Adds no box, stacking context or containing block, as Atlas's host (`display: contents` in Atlas's styles).
  host.style.display = 'contents';
  own.add(host);
  return host;
}

/** Removes Tabletop's own hosts, with whatever is still in them (Tabletop unloads); Atlas's host is Atlas's. */
export function releasePortalHosts(): void {
  for (const host of own) host.remove();
  own.clear();
}
