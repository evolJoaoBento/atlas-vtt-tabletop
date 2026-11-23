// Tabletop's entries in the copied command palette (added by the patch in scripts/atlasPortList.mjs): every toolbar
// button and Tabletop's lighting and board settings (src/palette/tabletopCommands.ts), drawn as Atlas's own entries
// with lucide icons, in the Settings tab.
import {
  Blend, BrickWall, CircleDashed, Clapperboard, Cloud, Command, Dices, Ellipsis, Eye, EyeOff, Flashlight, Focus,
  Hammer, Hand, Image as ImageIcon, Lamp, Layers, ListOrdered, Moon, Mountain, NotebookText, PaintRoller, Plug, Radio,
  Redo2, Ruler, ScanEye, ScrollText, Settings2, Shapes, SlidersHorizontal, SquareStack, Sun, Sunset, Swords, TentTree, Undo2, Waves,
} from 'lucide-react';
import { CoinIcon } from '../app/react/components/CoinIcon';
import { paletteHost } from '../../palette/paletteHost';
import type { TabletopCommand } from '../../palette/tabletopCommands';
import type { ToolbarCommandIcon } from '../../board/toolbarButtons';

const ICONS: Readonly<Record<ToolbarCommandIcon, React.ComponentType>> = {
  sun: Sun, sunset: Sunset, moon: Moon, lamp: Lamp, blur: Focus, shadow: SquareStack, bricks: BrickWall,
  eye: Eye, 'eye-off': EyeOff, layers: Layers, blend: Blend, sight: ScanEye, 'circle-dashed': CircleDashed,
  swords: Swords, hammer: Hammer, clapperboard: Clapperboard, dice: Dices, scroll: ScrollText, notebook: NotebookText,
  'list-ordered': ListOrdered, settings: Settings2, undo: Undo2, redo: Redo2, hand: Hand, flashlight: Flashlight,
  sliders: SlidersHorizontal, ruler: Ruler, shapes: Shapes, waves: Waves, mountain: Mountain, 'paint-roller': PaintRoller,
  cloud: Cloud, ground: TentTree, radio: Radio, coin: CoinIcon, image: ImageIcon, command: Command, ellipsis: Ellipsis, plug: Plug,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function option(command: TabletopCommand, onClose: () => void): any {
  const Icon = ICONS[command.icon];
  return {
    id: command.id,
    icon: <Icon />,
    label: command.label,
    keywords: command.keywords,
    section: 'settings',
    ...(command.submenu
      ? { hasSubmenu: true, submenu: command.submenu.map((child) => option(child, onClose)) }
      : {
          action: () => {
            onClose();
            command.run?.();
          },
          isToggle: command.active !== undefined,
          isActive: command.active === true,
        }),
  };
}

export function tabletopCommands(onClose: () => void): any[] {
  return (paletteHost()?.tabletopCommands?.() ?? []).map((command) => option(command, onClose));
}
