// Stand-in for Atlas's react/root/AtlasUIContext.tsx @ 0.15.0 (AGPL-3.0) in the copies: on the board there is no Atlas map
// view, Pixi app or renderer, only Obsidian's app.
import { createContext, useContext } from 'react';
import type { App } from 'obsidian';

export interface AtlasUIContextValue {
  app: App;
  view: null;
  pixiApp: null;
  renderer: null;
}

export const AtlasUIContext = createContext<AtlasUIContextValue | null>(null);

export const useAtlasUI = (): AtlasUIContextValue => {
  const context = useContext(AtlasUIContext);
  if (!context) throw new Error('useAtlasUI must be used within an AtlasUIContext provider');
  return context;
};
