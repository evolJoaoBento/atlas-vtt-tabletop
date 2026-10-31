/** Renders Atlas's stat block card of a note with Obsidian's own markdown renderer (the fence Atlas draws it from). */
import { Component, MarkdownRenderer, type App } from 'obsidian';
import type { CardHost } from './atlasCard';

/** The path of the note, without a heading (`note.md#Goblin`). */
const notePath = (path: string): string => path.split('#')[0] ?? path;

export function atlasCardHost(app: App, path: string, name?: string): CardHost {
  const component = new Component();
  component.load();
  return {
    name,
    // An empty fence: Atlas draws the stat block of the note it stands in, as its template lays it out.
    render: (into) => MarkdownRenderer.render(app, '```atlas-statblock\n```', into, notePath(path), component),
    dispose: () => component.unload(),
  };
}
