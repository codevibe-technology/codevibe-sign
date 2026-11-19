import type { FileStore } from '@codevibe/sign-core';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const SAFE_KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** Stores files under `dir`, one file per key. Keys may contain `/` but never `..`. */
export function localFileStore(dir: string): FileStore {
  const root = resolve(dir);

  function pathFor(key: string): string {
    if (!SAFE_KEY.test(key) || key.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error(`Unsafe file key: ${key}`);
    }
    const path = join(root, key);
    if (!path.startsWith(root + sep)) throw new Error(`Unsafe file key: ${key}`);
    return path;
  }

  return {
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temp, bytes);
      await rename(temp, path);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

/** Keeps files in memory. For tests and demos. */
export function memoryFileStore(): FileStore {
  const files = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      files.set(key, new Uint8Array(bytes));
    },
    async get(key) {
      const bytes = files.get(key);
      return bytes ? new Uint8Array(bytes) : null;
    },
    async delete(key) {
      files.delete(key);
    },
  };
}
