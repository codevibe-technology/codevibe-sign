import { describe, expect, it } from 'vitest';
import config from './config.ts';

describe('the docs theme before a reader picks one', () => {
  it('is light, with the switch to dark still there', () => {
    expect(config.appearance).toEqual({ initialValue: 'light' });
  });
});
