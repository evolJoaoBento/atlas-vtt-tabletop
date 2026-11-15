// Atlas source: src/app/utils/sceneName.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { t } from '../../shims/i18n';

/** A scene is named like its file: map files carry no name of their own. */
export function sceneNameOf(path: string | null): string {
  const fileName = path?.replace(/\\/g, '/').split('/').pop() ?? '';
  return fileName.replace(/\.[^.]+$/, '').trim() || t('map.untitled');
}
