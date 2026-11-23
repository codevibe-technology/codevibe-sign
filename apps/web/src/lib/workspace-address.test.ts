import { describe, expect, it } from 'vitest';
import {
  ADDRESS_MAX,
  addressAlternatives,
  checkAddressFormat,
  RESERVED_ADDRESSES,
  suggestAddress,
  tidyAddressInput,
  transliterate,
} from './workspace-address';

describe('suggestAddress', () => {
  it('turns a company name into lower-case words joined by hyphens', () => {
    expect(suggestAddress('Codevibe Technologies Pvt. Ltd.')).toBe('codevibe-technologies-pvt-ltd');
    expect(suggestAddress('  Acme   HR  ')).toBe('acme-hr');
    expect(suggestAddress("Ravi's Books")).toBe('ravis-books');
    expect(suggestAddress('Johnson & Johnson')).toBe('johnson-and-johnson');
    expect(suggestAddress('Team_42 / Legal')).toBe('team-42-legal');
  });

  it('drops accents and spells out letters that do not decompose', () => {
    expect(suggestAddress('Café Société')).toBe('cafe-societe');
    expect(suggestAddress('Straße Ølstue')).toBe('strasse-olstue');
    expect(suggestAddress('Łódź')).toBe('lodz');
  });

  it('writes Indian scripts in Latin letters', () => {
    expect(suggestAddress('भारत')).toBe('bharat');
    expect(suggestAddress('नमस्ते इंडिया')).toBe('namaste-indiya');
    expect(suggestAddress('कृष्ण')).toBe('krishna');
    expect(suggestAddress('ज़रा फ़र्क')).toBe('zara-fark');
    expect(suggestAddress('हिंदी')).toBe('hindi');
    expect(suggestAddress('தமிழ்')).toBe('tamizh');
    expect(suggestAddress('சென்னை')).toBe('chennai');
    expect(suggestAddress('హైదరాబాద్')).toBe('haidarabad');
    expect(suggestAddress('কলকাতা')).toBe('kalakata');
    expect(suggestAddress('ಬೆಂಗಳೂರು')).toBe('bengaluru');
    expect(suggestAddress('കേരളം')).toBe('keralam');
    expect(suggestAddress('ગુજરાત')).toBe('gujarat');
    expect(suggestAddress('ਪੰਜਾਬ')).toBe('panjab');
  });

  it('keeps Indian digits as digits and mixes scripts', () => {
    expect(suggestAddress('टीम ४२')).toBe('tim-42');
    expect(suggestAddress('Acme भारत')).toBe('acme-bharat');
  });

  it('falls back when nothing can be written in Latin letters', () => {
    expect(suggestAddress('')).toBe('workspace');
    expect(suggestAddress('東京')).toBe('workspace');
    expect(suggestAddress('!!!')).toBe('workspace');
  });

  it('pads short and reserved names so the suggestion is always allowed', () => {
    expect(suggestAddress('HR')).toBe('hr-workspace');
    expect(suggestAddress('Admin')).toBe('admin-workspace');
    expect(suggestAddress('API')).toBe('api-workspace');
    for (const name of ['', 'HR', 'Docs', '東京', 'x'.repeat(200), 'a - - b', 'भारत']) {
      expect(checkAddressFormat(suggestAddress(name))).toEqual({ ok: true });
    }
  });

  it('cuts long names at the limit without a trailing hyphen', () => {
    const slug = suggestAddress('The Very Long Company Name Of A Large Indian Enterprise Group');
    expect(slug.length).toBeLessThanOrEqual(ADDRESS_MAX);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('transliterate', () => {
  it('leaves Latin text alone', () => {
    expect(transliterate('Acme HR 2')).toBe('Acme HR 2');
  });
});

describe('checkAddressFormat', () => {
  it('accepts lower-case letters, digits and single inner hyphens', () => {
    expect(checkAddressFormat('codevibe')).toEqual({ ok: true });
    expect(checkAddressFormat('acme-hr-2')).toEqual({ ok: true });
    expect(checkAddressFormat('123')).toEqual({ ok: true });
  });

  it.each([
    ['', 'empty'],
    ['ab', 'short'],
    ['a'.repeat(ADDRESS_MAX + 1), 'long'],
    ['Acme', 'chars'],
    ['acme hr', 'chars'],
    ['acme_hr', 'chars'],
    ['acmé', 'chars'],
    ['-acme', 'edges'],
    ['acme-', 'edges'],
    ['acme--hr', 'hyphens'],
    ['dashboard', 'reserved'],
    ['api', 'reserved'],
    ['www', 'reserved'],
  ])('refuses %j (%s)', (slug, problem) => {
    const result = checkAddressFormat(slug);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toBe(problem);
      expect(result.message).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('reserves the words the owner listed', () => {
    for (const word of [
      'dashboard',
      'api',
      'docs',
      'settings',
      'admin',
      'new',
      'sign',
      'verify',
      'www',
    ]) {
      expect(RESERVED_ADDRESSES.has(word)).toBe(true);
    }
  });
});

describe('tidyAddressInput', () => {
  it('tidies what is typed without fighting the cursor', () => {
    expect(tidyAddressInput('Acme HR')).toBe('acme-hr');
    expect(tidyAddressInput('acme-')).toBe('acme-');
    expect(tidyAddressInput('--acme__hr..x')).toBe('acme-hr-x');
    expect(tidyAddressInput('café!')).toBe('cafe');
    expect(tidyAddressInput('x'.repeat(80))).toHaveLength(ADDRESS_MAX);
  });
});

describe('addressAlternatives', () => {
  it('numbers the base, replacing a number already on the end', () => {
    expect(addressAlternatives('codevibe', 3)).toEqual(['codevibe-2', 'codevibe-3', 'codevibe-4']);
    expect(addressAlternatives('codevibe-2', 3)).toEqual([
      'codevibe-3',
      'codevibe-4',
      'codevibe-5',
    ]);
  });

  it('stays within the length limit', () => {
    for (const slug of addressAlternatives('a'.repeat(ADDRESS_MAX), 12)) {
      expect(slug.length).toBeLessThanOrEqual(ADDRESS_MAX);
      expect(checkAddressFormat(slug)).toEqual({ ok: true });
    }
  });
});
