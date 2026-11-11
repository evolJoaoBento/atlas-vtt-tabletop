/**
 * The web player's sound control: a speaker button in a corner of the board that opens a volume slider and a mute
 * toggle. What the player chose is kept in this browser under `tabletop-sound`; the board's sound groups all stay on.
 */
import { DEFAULT_SOUND_SETTINGS, readSoundSettings, type SoundSettings } from '../sound/soundSettings';

export const SOUND_STORAGE_KEY = 'tabletop-sound';

/** What this browser kept, or the defaults; storage that is missing or refuses is ignored. */
export function loadStoredSound(storage: Pick<Storage, 'getItem'> | null): SoundSettings {
  try {
    const raw = storage?.getItem(SOUND_STORAGE_KEY);
    return raw ? readSoundSettings(JSON.parse(raw)) : DEFAULT_SOUND_SETTINGS;
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

function keepSound(storage: Pick<Storage, 'setItem'> | null, settings: SoundSettings): void {
  try {
    storage?.setItem(SOUND_STORAGE_KEY, JSON.stringify({ volume: settings.volume, muted: settings.muted }));
  } catch {
    // Private windows and blocked storage: the choice lasts until the page closes.
  }
}

function storageOf(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path class="wave" d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/><path class="cross" d="m16 9 6 6m0-6-6 6"/></svg>';

/** What the web player gives the board: the settings now, and a way to hear of a change. */
export interface WebSound {
  settings(): SoundSettings;
  onChange(listener: () => void): () => void;
}

/** The settings this browser keeps; `settings()` returns a new object at each change, so a reader can tell. */
export function webSound(win: Window = window): WebSound & { set(changes: Partial<Pick<SoundSettings, 'volume' | 'muted'>>): void } {
  const storage = storageOf(win);
  let current = loadStoredSound(storage);
  const listeners = new Set<() => void>();
  return {
    settings: () => current,
    onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (changes) => {
      current = readSoundSettings({ ...current, ...changes });
      keepSound(storage, current);
      for (const listener of [...listeners]) listener();
    },
  };
}

/** An element with a class and attributes, made with plain DOM so it needs no Obsidian helpers. */
function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, attr: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = cls;
  for (const [name, value] of Object.entries(attr)) element.setAttribute(name, value);
  return element;
}

/** Draws the speaker button and its panel into `parent`; returns what removes them. */
export function mountSoundControl(parent: HTMLElement, sound: ReturnType<typeof webSound>): () => void {
  const doc = parent.ownerDocument;
  const root = make(doc, 'div', 'atlas-tabletop-sound');
  const button = make(doc, 'button', 'atlas-tabletop-sound__button', { type: 'button', 'aria-label': 'Sound', 'aria-expanded': 'false' });
  button.innerHTML = SPEAKER;
  const panel = make(doc, 'div', 'atlas-tabletop-sound__panel');
  panel.hidden = true;
  const slider = make(doc, 'input', 'atlas-tabletop-sound__volume', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume' });
  const mute = make(doc, 'label', 'atlas-tabletop-sound__mute');
  const check = make(doc, 'input', '', { type: 'checkbox' });
  mute.append(check, doc.createTextNode(' Mute'));
  panel.append(slider, mute);
  root.append(button, panel);
  parent.appendChild(root);
  const show = (): void => {
    const now = sound.settings();
    slider.value = String(now.volume);
    check.checked = now.muted;
    button.classList.toggle('is-muted', now.muted || now.volume === 0);
  };
  show();
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  slider.addEventListener('input', () => sound.set({ volume: Number(slider.value) }));
  check.addEventListener('change', () => sound.set({ muted: check.checked }));
  const stop = sound.onChange(show);
  return () => { stop(); root.remove(); };
}
