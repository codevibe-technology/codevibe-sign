import { describe, expect, it } from 'vitest';
import { clipFiles, clipSize, playsOnItsOwn } from './help-clip';

describe('help clips', () => {
  it('names the WebM, MP4 and poster of a clip', () => {
    expect(clipFiles('guided-signing')).toEqual({
      webm: '/clips/guided-signing.webm',
      mp4: '/clips/guided-signing.mp4',
      poster: '/clips/guided-signing.webp',
    });
  });

  it('refuses a name that is not a plain file stem', () => {
    expect(() => clipFiles('../secret')).toThrow('Not a clip name');
    expect(() => clipFiles('Guided Signing')).toThrow('Not a clip name');
    expect(() => clipFiles('')).toThrow('Not a clip name');
  });

  it('sizes desktop and phone clips', () => {
    expect(clipSize(false)).toEqual({ width: 1280, height: 800 });
    expect(clipSize(true)).toEqual({ width: 540, height: 1168 });
  });

  it('keeps still when the reader asks for less motion', () => {
    expect(playsOnItsOwn(false)).toBe(true);
    expect(playsOnItsOwn(true)).toBe(false);
  });
});
