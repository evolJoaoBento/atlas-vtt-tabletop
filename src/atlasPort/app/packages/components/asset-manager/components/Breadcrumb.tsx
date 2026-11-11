// Atlas source: src/app/packages/components/asset-manager/components/Breadcrumb.tsx @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React, { useId } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import type { Tab, Folder as FolderType } from '../types';
import { getTabDisplayName } from '../types';
import { t } from '../../../../../shims/i18n';

export interface BreadcrumbProps {
  activeTab: Tab;
  /** Folders from the tab root down to the open folder; empty at the root. */
  path: FolderType[];
  onNavigateToFolder: (folderId: string | null) => void;
}

/** Path from the tab root to the open folder. The last segment is the current location. */
export function Breadcrumb({ activeTab, path, onNavigateToFolder }: BreadcrumbProps): React.JSX.Element {
  const labelId = useId();

  const segment = (key: string, label: string, folderId: string | null, isCurrent: boolean): React.JSX.Element => (
    <button
      key={key}
      type="button"
      className={`atlas-breadcrumb-btn ${isCurrent ? 'atlas-current' : ''}`}
      onClick={() => onNavigateToFolder(folderId)}
      aria-current={isCurrent ? 'location' : undefined}
    >
      {folderId && <Folder />}
      <span>{label}</span>
    </button>
  );

  return (
    <nav className="atlas-asset-manager-breadcrumb" aria-labelledby={labelId}>
      <span id={labelId} hidden>{t('am.breadcrumb')}</span>
      {segment('root', getTabDisplayName(activeTab), null, path.length === 0)}
      {path.map((folder, index) => (
        <React.Fragment key={folder.id}>
          <ChevronRight className="atlas-breadcrumb-separator" />
          {segment(folder.id, folder.name, folder.id, index === path.length - 1)}
        </React.Fragment>
      ))}
    </nav>
  );
}
