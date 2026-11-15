// Atlas source: src/app/react/components/context-menu/tokenSizeMenu.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { ContextMenuEntry } from './AtlasContextMenu';
import { TOKEN_SIZE_OPTIONS } from '../../../pixi/token-renderer/tokenSizing';
import { t } from '../../../../shims/i18n';

/** "Size" submenu shared by the map token menu and the asset manager; `currentSize` undefined means 1×1. */
export function tokenSizeSubmenu(currentSize: number | undefined, onSelect: (size: number) => void): ContextMenuEntry {
  const children: ContextMenuEntry[] = TOKEN_SIZE_OPTIONS.map(option => ({
    type: 'item',
    label: option.label,
    checked: (currentSize ?? 1) === option.size,
    onClick: () => onSelect(option.size),
  }));
  return { type: 'submenu', label: t('menu.size'), icon: 'scaling', children };
}
