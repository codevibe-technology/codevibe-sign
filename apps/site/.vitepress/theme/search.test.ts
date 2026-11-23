import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetSearches, readRecent, rememberSearch } from './search.ts';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('recent searches', () => {
  it('keeps the last five, newest first, without duplicates', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    for (const q of ['a', 'b', 'c', 'd', 'e', 'f', 'c', '  ']) rememberSearch(q);
    expect(readRecent()).toEqual(['c', 'f', 'e', 'd', 'b']);
    forgetSearches();
    expect(readRecent()).toEqual([]);
  });

  it('ignores stored values that are not a list of strings', () => {
    const storage = memoryStorage();
    storage.setItem('cvsign-docs-recent-searches', '{"x":1}');
    vi.stubGlobal('localStorage', storage);
    expect(readRecent()).toEqual([]);
    storage.setItem('cvsign-docs-recent-searches', 'not json');
    expect(readRecent()).toEqual([]);
  });

  it('works when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('localStorage', blocked);
    expect(() => rememberSearch('x')).not.toThrow();
    expect(() => forgetSearches()).not.toThrow();
    expect(readRecent()).toEqual([]);
  });
});
