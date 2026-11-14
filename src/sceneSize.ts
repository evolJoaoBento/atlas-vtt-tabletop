/**
 * A scene's size in its own pixels without a board of it: its background (an image, or a video) read from the vault
 * for its natural size, as its grid alignment draws it (`board/mapStretch.ts` `worldSize`). Null when there is no
 * background, it is not in the vault, or it cannot be read in a few seconds.
 */
import { TFile, type App } from 'obsidian';
import { readMapStretch, worldSize } from './board/mapStretch';

const VIDEO = /\.(webm|mp4|m4v|mov|ogv)$/i;
const READ_MS = 8000;

function videoSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let done = false;
    const end = (size: { width: number; height: number } | null): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(size);
    };
    const timer = window.setTimeout(() => end(null), READ_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.addEventListener('loadedmetadata', () => end(video.videoWidth > 0 && video.videoHeight > 0 ? { width: video.videoWidth, height: video.videoHeight } : null), { once: true });
    video.addEventListener('error', () => end(null), { once: true });
    video.src = url;
  });
}

function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(null), READ_MS);
    image.addEventListener('load', () => { window.clearTimeout(timer); resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null); }, { once: true });
    image.addEventListener('error', () => { window.clearTimeout(timer); resolve(null); }, { once: true });
    image.src = url;
  });
}

export async function sceneWorldSize(app: App, background: string | null, grid: unknown): Promise<{ width: number; height: number } | null> {
  if (!background) return null;
  const file = app.vault.getAbstractFileByPath(background);
  if (!(file instanceof TFile)) return null;
  const url = app.vault.getResourcePath(file);
  const size = await (VIDEO.test(background) ? videoSize(url) : imageSize(url));
  if (!size) return null;
  const stretch = readMapStretch((grid as { mapStretch?: unknown } | null)?.mapStretch);
  return worldSize(size, stretch ?? { x: 1, y: 1 });
}
