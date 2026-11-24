// Atlas source: src/app/react/components/command-palette/armariumCommand.tsx @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import { Store } from 'lucide-react';
import { t } from '../../../../shims/i18n';
import type { CommandOption } from './types';

/** The palette's way to the Armarium: it opens the asset manager on the store and closes the palette. */
export function armariumCommand(open: () => void, close: () => void): CommandOption {
  return {
    id: 'open-armarium',
    icon: <Store />,
    label: t('armarium.title'),
    keywords: ['armarium', 'store', 'shop', 'library', 'collections', 'download', 'install', 'adventures', 'modules', 'community'],
    section: 'tools',
    action: () => {
      open();
      close();
    },
  };
}
