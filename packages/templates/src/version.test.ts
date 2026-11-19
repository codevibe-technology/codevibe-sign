import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDERS, webCryptoHasher } from '@codevibe_technology/sign-core';
import { canonicalJson, templateVersion } from './version';
import { offerTemplate } from './test/fixtures';
import type { Template } from './types';

const version = (template: Template) => templateVersion(template, webCryptoHasher);

function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reversedKeys(v)]),
    ) as T;
  }
  return value;
}

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: undefined }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"f":1}]},"b":1}',
    );
  });

  it('rejects values JSON cannot hold', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(TypeError);
  });
});

describe('templateVersion', () => {
  it('is a SHA-256 hex digest', async () => {
    expect(await version(offerTemplate())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls and key order', async () => {
    const first = await version(offerTemplate());
    expect(await version(offerTemplate())).toBe(first);
    expect(await version(reversedKeys(offerTemplate()))).toBe(first);
  });

  it('does not change when defaults are written out', async () => {
    const plain = offerTemplate();
    const spelled = offerTemplate();
    spelled.routing = 'sequential';
    spelled.reminders = { ...DEFAULT_REMINDERS };
    spelled.roles[0]!.type = 'signer';
    spelled.roles[0]!.order = 1;
    spelled.roles[1]!.order = 2;
    spelled.roles[1]!.fields![0]!.required = true;
    spelled.roles[0]!.fields![1]!.readOnly = false;
    expect(await version(spelled)).toBe(await version(plain));
  });

  it('changes with anything that shapes the envelope', async () => {
    const base = await version(offerTemplate());
    const changes: ((t: Template) => void)[] = [
      (t) => (t.title = 'Offer letter v2'),
      (t) => (t.expiresInDays = 7),
      (t) => (t.routing = 'parallel'),
      (t) => (t.documents[0]!.sha256 = 'c'.repeat(64)),
      (t) => (t.roles[1]!.auth = 'email_link'),
      (t) => (t.roles[0]!.fields![2]!.rect.x += 1),
      (t) => t.roles.reverse(),
    ];
    const versions = await Promise.all(
      changes.map((change) => {
        const template = offerTemplate();
        change(template);
        return version(template);
      }),
    );
    for (const v of versions) expect(v).not.toBe(base);
    expect(new Set(versions).size).toBe(changes.length);
  });

  it('matches the pinned digest, so the format cannot drift unnoticed', async () => {
    expect(await version(offerTemplate())).toBe(
      '81619213483f01f9c43abf094c4374aff013aee44d1e4892bcfff32c4b5e5463',
    );
  });
});
