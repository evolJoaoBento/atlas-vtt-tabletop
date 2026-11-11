// Tabletop's entries in the copied command palette (added by the patch in scripts/atlasPortList.mjs): Tabletop's lighting
// and board settings (src/palette/tabletopCommands.ts), drawn as Atlas's own entries with lucide icons, in the Settings tab.
import { BrickWall, Dices, Eye, Focus, Lamp, Layers, Moon, ScanEye, Settings2, SquareStack, Sun, Sunset, Swords } from 'lucide-react';
import { paletteHost } from '../../palette/paletteHost';
import type { TabletopCommand } from '../../palette/tabletopCommands';

const ICONS = {
  sun: Sun, sunset: Sunset, moon: Moon, lamp: Lamp, blur: Focus, shadow: SquareStack, bricks: BrickWall,
  eye: Eye, layers: Layers, sight: ScanEye, swords: Swords, dice: Dices, settings: Settings2,
} as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
function option(command: TabletopCommand): any {
  const Icon = ICONS[command.icon];
  return {
    id: command.id,
    icon: <Icon />,
    label: command.label,
    keywords: command.keywords,
    section: 'settings',
    ...(command.submenu
      ? { hasSubmenu: true, submenu: command.submenu.map(option) }
      : { action: command.run, isToggle: command.active !== undefined, isActive: command.active === true }),
  };
}

export function tabletopCommands(_onClose: () => void): any[] {
  return (paletteHost()?.tabletopCommands?.() ?? []).map(option);
}
