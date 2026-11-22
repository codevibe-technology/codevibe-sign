import { describe, expect, it, vi } from 'vitest';
import { limitMagicLinks, MAGIC_LINKS_PER_WINDOW, TooManySignInLinks } from './magic-link-limit';

describe('limitMagicLinks', () => {
  function setup() {
    let now = Date.parse('2026-11-23T10:00:00.000Z');
    const send = vi.fn(async () => undefined);
    const limited = limitMagicLinks(send, () => new Date(now));
    return { send, limited, advance: (ms: number) => (now += ms) };
  }

  it('stops sending to one address after the limit and says when to try again', async () => {
    const { send, limited } = setup();
    for (let i = 0; i < MAGIC_LINKS_PER_WINDOW; i++) await limited('asha@example.com', `u${i}`);
    await expect(limited('asha@example.com', 'again')).rejects.toBeInstanceOf(TooManySignInLinks);
    await expect(limited('asha@example.com', 'again')).rejects.toThrow(/Use the latest one/);
    expect(send).toHaveBeenCalledTimes(MAGIC_LINKS_PER_WINDOW);
  });

  it('counts an address the same however it is written', async () => {
    const { send, limited } = setup();
    for (let i = 0; i < MAGIC_LINKS_PER_WINDOW; i++) await limited('Asha@Example.com ', 'u');
    await expect(limited('asha@example.com', 'u')).rejects.toBeInstanceOf(TooManySignInLinks);
    expect(send).toHaveBeenCalledTimes(MAGIC_LINKS_PER_WINDOW);
  });

  it('keeps other addresses working and opens again after the window', async () => {
    const { send, limited, advance } = setup();
    for (let i = 0; i < MAGIC_LINKS_PER_WINDOW; i++) await limited('asha@example.com', 'u');
    await limited('ravi@example.com', 'u');
    advance(15 * 60 * 1000);
    await limited('asha@example.com', 'u');
    expect(send).toHaveBeenCalledTimes(MAGIC_LINKS_PER_WINDOW + 2);
  });
});
