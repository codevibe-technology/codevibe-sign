/** Where the short help clips live, under the docs' `public/clips/`. */
export const CLIP_DIR = 'clips';

export interface ClipFiles {
  webm: string;
  mp4: string;
  poster: string;
}

/** The three files of a clip, relative to the docs base: WebM first, MP4 for Safari, a WebP poster. */
export function clipFiles(name: string): ClipFiles {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Not a clip name: ${name}`);
  const stem = `/${CLIP_DIR}/${name}`;
  return { webm: `${stem}.webm`, mp4: `${stem}.mp4`, poster: `${stem}.webp` };
}

/** Desktop clips are 16:10; phone clips are a phone screen. */
export const clipSize = (phone: boolean) =>
  phone ? { width: 540, height: 1168 } : { width: 1280, height: 800 };

/**
 * Whether a clip may start on its own once it is on screen. With reduced motion it shows its
 * poster and a play button instead, and moves only when asked to.
 */
export const playsOnItsOwn = (reducedMotion: boolean) => !reducedMotion;
