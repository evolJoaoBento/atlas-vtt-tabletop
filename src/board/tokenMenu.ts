/**
 * A token's menu on the 3D board, as Atlas's token menu has it (its `InteractionController.showContextMenu`): the
 * Conditions submenu (each condition's badge, ticked when the token has it, − value + for a valued one, staying open
 * while conditions are set), Hide or Show, Add to or Remove from Initiative; then Tabletop's own (the mini, disc or
 * standee); Reset when the token tracks resources; Kill and Delete side by side. Entries only: `atlasMenu.ts` draws
 * them, and `actions` (the board's tab) carry them out.
 */
import type { CollectionRules, ConditionDefinition } from './conditions';
import { CONDITION_ICON_PATHS } from './conditionIconData';
import type { MenuEntry } from './atlasMenu';
import type { BoardToken, TokenSettings } from './mapModel';
import { isKillable, resetLabel, visibleResources } from './resources';

export interface TokenMenuActions {
  setCondition(id: string, active: boolean): void;
  stepCondition(id: string, delta: number): void;
  setHidden(hidden: boolean): void;
  setInitiative(join: boolean): void;
  assignMini(): void;
  removeMini(): void;
  setStandee(standee: boolean): void;
  /** How high the light the token carries hangs, in grid squares. */
  setLightHeight(height: number): void;
  reset(): void;
  kill(): void;
  remove(): void;
}

export interface TokenMenuContext {
  /** The token as it is now (read again whenever the menu redraws); null once it is gone. */
  token(): BoardToken | null;
  rules: CollectionRules;
  settings(): TokenSettings;
  inInitiative(): boolean;
  hasMini(): boolean;
  standee(): boolean;
  /** How high the light the token carries hangs, in squares; null when it carries none. */
  lightHeight(): number | null;
  actions: TokenMenuActions;
  /** Draws an Obsidian (Lucide) icon into an element. */
  icon(element: HTMLElement, name: string): void;
}

const BADGE_SIZE = 16;
/** The light height steps a quarter square. */
const LIGHT_STEP = 0.25;

/** Whether a colour is light enough that a dark glyph reads better on it (Atlas's `isLightBadgeColor`). */
export function isLightBadgeColor(hex: string): boolean {
  const color = Number.parseInt(hex.replace('#', ''), 16) || 0;
  const channel = (shift: number): number => {
    const value = ((color >> shift) & 0xff) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0) > 0.45;
}

/** A condition's badge as tokens show it in Atlas: its colour, and its icon (or its initial) in white or dark. */
function conditionBadge(doc: Document, condition: ConditionDefinition): HTMLElement {
  const badge = doc.createElement('span');
  badge.className = `atlas-condition-badge${isLightBadgeColor(condition.color) ? ' atlas-condition-badge--light' : ''}`;
  badge.setAttribute('aria-hidden', 'true');
  badge.style.setProperty('--atlas-condition-color', condition.color);
  badge.style.width = `${BADGE_SIZE}px`;
  badge.style.height = `${BADGE_SIZE}px`;
  badge.style.fontSize = `${BADGE_SIZE * 0.5}px`;
  const path = condition.icon ? CONDITION_ICON_PATHS[condition.icon] : undefined;
  if (path) {
    const size = Math.round(BADGE_SIZE * 0.62);
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('fill', 'currentColor');
    const glyph = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    glyph.setAttribute('d', path);
    svg.appendChild(glyph);
    badge.appendChild(svg);
  } else {
    badge.textContent = (Array.from(condition.name.trim())[0] ?? '?').toLocaleUpperCase();
  }
  return badge;
}

export function tokenMenuEntries(context: TokenMenuContext): MenuEntry[] {
  const token = context.token();
  if (!token) return [];
  const { actions, rules } = context;
  const entries: MenuEntry[] = [];

  if (rules.conditions.size > 0) {
    entries.push({
      type: 'submenu',
      label: 'Conditions',
      icon: 'palette',
      children: () => {
        const now = context.token();
        if (!now) return [];
        return [...rules.conditions].map(([id, condition]): MenuEntry => {
          const has = now.conditions.includes(id);
          const name = condition.name.trim() || 'Unnamed condition';
          return {
            type: 'item',
            label: name,
            checked: has,
            keepOpen: true,
            leading: (doc) => conditionBadge(doc, condition),
            onClick: () => actions.setCondition(id, !has),
            ...(condition.valued && {
              stepper: {
                value: has ? String(now.conditionValues[id] ?? 1) : '0',
                label: name,
                canDecrement: has,
                onDecrement: () => actions.stepCondition(id, -1),
                onIncrement: () => actions.stepCondition(id, 1),
              },
            }),
          };
        });
      },
    });
  }

  entries.push({ type: 'item', label: token.hidden ? 'Show' : 'Hide', onClick: () => actions.setHidden(!token.hidden) });
  const joined = context.inInitiative();
  entries.push({ type: 'item', label: joined ? 'Remove from Initiative' : 'Add to Initiative', onClick: () => actions.setInitiative(!joined) });

  // Tabletop's own: what the token is drawn as on the 3D board.
  entries.push({ type: 'separator' });
  const hasMini = context.hasMini();
  entries.push({ type: 'item', label: hasMini ? 'Change mini…' : 'Assign mini…', onClick: () => actions.assignMini() });
  if (hasMini) entries.push({ type: 'item', label: 'Remove mini', onClick: () => actions.removeMini() });
  const standee = context.standee();
  entries.push({ type: 'item', label: standee ? 'Show as disc' : 'Show as standee', onClick: () => actions.setStandee(!standee) });
  const height = context.lightHeight();
  if (height !== null) {
    entries.push({
      type: 'item', label: 'Light height', keepOpen: true, onClick: () => undefined,
      stepper: { value: `${height} sq`, label: 'Light height', canDecrement: height > 0, onDecrement: () => actions.setLightHeight(height - LIGHT_STEP), onIncrement: () => actions.setLightHeight(height + LIGHT_STEP) },
    });
  }

  const tracked = token.kind === 'character' && visibleResources(token, rules.definitions, context.settings().hiddenResources).length > 0;
  if (tracked) entries.push({ type: 'item', label: resetLabel(rules.definitions), onClick: () => actions.reset() });

  const killable = token.kind === 'character' && isKillable(token, rules.definitions);
  entries.push({
    type: 'custom',
    render: (doc, close) => {
      const row = doc.createElement('div');
      row.className = 'atlas-ctx-destructive-row';
      const button = (icon: string, label: string, action: () => void): void => {
        const made = doc.createElement('div');
        made.className = 'atlas-ctx-destructive-btn';
        made.setAttribute('role', 'menuitem');
        made.tabIndex = 0;
        const glyph = doc.createElement('span');
        glyph.className = 'atlas-ctx-icon';
        context.icon(glyph, icon);
        made.append(glyph, Object.assign(doc.createElement('span'), { textContent: label }));
        made.addEventListener('click', (event) => { event.stopPropagation(); action(); close(); });
        row.appendChild(made);
      };
      if (killable) button('skull', 'Kill', () => actions.kill());
      button('trash', 'Delete', () => actions.remove());
      return row;
    },
  });
  return entries;
}

