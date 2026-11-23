'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False on the server and for the first paint in the browser, true after. Use it for text
 * the two may word differently, such as a time zone's offset, so the first paint matches the
 * server's HTML exactly and the browser's wording comes in right after.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
