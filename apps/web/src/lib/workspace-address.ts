/**
 * The rules for a workspace's address, the part of `/dashboard/<address>` people choose. The
 * browser uses them to answer while someone types; the server applies the same rules again
 * before it saves anything.
 */

export const ADDRESS_MIN = 3;
export const ADDRESS_MAX = 40;
/** Days a retired address stays out of reach of other workspaces. */
export const ADDRESS_COOL_DOWN_DAYS = 90;
/** Address changes one workspace may make in `ADDRESS_CHANGE_WINDOW_DAYS`. */
export const ADDRESS_CHANGES_PER_WINDOW = 5;
export const ADDRESS_CHANGE_WINDOW_DAYS = 30;

/** Words the app uses for its own pages, or that would mislead people reading a link. */
export const RESERVED_ADDRESSES: ReadonlySet<string> = new Set([
  'account',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'brand',
  'create',
  'dashboard',
  'docs',
  'edit',
  'health',
  'help',
  'invite',
  'login',
  'logout',
  'new',
  'null',
  'onboarding',
  'public',
  'root',
  'settings',
  'sign',
  'sign-in',
  'sign-up',
  'signin',
  'signup',
  'static',
  'status',
  'support',
  'system',
  'undefined',
  'verify',
  'www',
]);

export type AddressProblem =
  | 'empty'
  | 'short'
  | 'long'
  | 'chars'
  | 'edges'
  | 'hyphens'
  | 'reserved';

export type AddressFormat = { ok: true } | { ok: false; problem: AddressProblem; message: string };

/** Whether `slug` follows the address rules, and what to change when it does not. */
export function checkAddressFormat(slug: string): AddressFormat {
  const fail = (problem: AddressProblem, message: string): AddressFormat => ({
    ok: false,
    problem,
    message,
  });
  if (!slug) return fail('empty', 'Choose an address for the workspace.');
  if (/[^a-z0-9-]/.test(slug)) {
    return fail('chars', 'Use lower-case letters, numbers and hyphens only.');
  }
  if (slug.length < ADDRESS_MIN) return fail('short', `Use at least ${ADDRESS_MIN} characters.`);
  if (slug.length > ADDRESS_MAX) {
    return fail('long', `Keep it to ${ADDRESS_MAX} characters or fewer.`);
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return fail('edges', 'Start and end with a letter or a number.');
  }
  if (slug.includes('--')) return fail('hyphens', 'Use one hyphen at a time.');
  if (RESERVED_ADDRESSES.has(slug)) {
    return fail('reserved', `"${slug}" is used by the app itself. Try another address.`);
  }
  return { ok: true };
}

/**
 * What someone typed into the address box, tidied as they type: lower case, spaces and
 * underscores as hyphens, other characters dropped. A trailing hyphen is kept so the next word
 * can follow it.
 */
export function tidyAddressInput(raw: string): string {
  return foldLatin(raw)
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, ADDRESS_MAX);
}

/** The address a workspace name suggests. Never empty; always passes `checkAddressFormat`. */
export function suggestAddress(name: string): string {
  const slug = trimToLength(
    transliterate(name)
      .toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    ADDRESS_MAX,
  );
  if (!slug) return 'workspace';
  if (slug.length < ADDRESS_MIN) return `${slug}-workspace`;
  if (RESERVED_ADDRESSES.has(slug)) return `${slug}-workspace`;
  return slug;
}

/** Other addresses to offer when `base` is taken: `base-2`, `base-3`, and so on. */
export function addressAlternatives(base: string, count = 12): string[] {
  const root = base.replace(/-\d+$/, '') || base;
  const out: string[] = [];
  for (let n = 2; out.length < count; n++) {
    const suffix = `-${n}`;
    const slug = `${trimToLength(root, ADDRESS_MAX - suffix.length)}${suffix}`;
    if (slug !== base) out.push(slug);
  }
  return out;
}

function trimToLength(slug: string, max: number): string {
  return slug.length <= max ? slug : slug.slice(0, max).replace(/-+$/g, '');
}

const LATIN: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  Ł: 'L',
  ı: 'i',
  '&': ' and ',
  '@': ' at ',
};

/** Latin letters with accents as plain ones, and a few letters that do not decompose. */
function foldLatin(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // Back to composed form, so two-part vowel signs in Tamil or Telugu read as one sign again.
      .normalize('NFC')
      .replace(/[ßæÆœŒøØđĐðþłŁı&@]/g, (ch) => LATIN[ch] ?? ch)
  );
}

/** A name in Latin letters, with the Indian scripts written out in Latin letters too. */
export function transliterate(text: string): string {
  return transliterateIndic(foldLatin(text));
}

/*
 * The nine main Indian scripts share one layout: a letter sits at the same offset in each
 * Unicode block (ka is +0x15 in Devanagari, Bengali, Tamil and the rest). One table of
 * offsets therefore covers all of them.
 */
const INDIC_BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00];
/** Scripts that usually drop the last inherent "a" of a word: Hindi "bharat", not "bharata". */
const DROPS_FINAL_A = new Set([0x0900, 0x0980, 0x0a00, 0x0a80]);

const CONSONANTS: Record<number, string> = {
  0x15: 'k',
  0x16: 'kh',
  0x17: 'g',
  0x18: 'gh',
  0x19: 'n',
  0x1a: 'ch',
  0x1b: 'chh',
  0x1c: 'j',
  0x1d: 'jh',
  0x1e: 'n',
  0x1f: 't',
  0x20: 'th',
  0x21: 'd',
  0x22: 'dh',
  0x23: 'n',
  0x24: 't',
  0x25: 'th',
  0x26: 'd',
  0x27: 'dh',
  0x28: 'n',
  0x29: 'n',
  0x2a: 'p',
  0x2b: 'ph',
  0x2c: 'b',
  0x2d: 'bh',
  0x2e: 'm',
  0x2f: 'y',
  0x30: 'r',
  0x31: 'r',
  0x32: 'l',
  0x33: 'l',
  0x34: 'zh',
  0x35: 'v',
  0x36: 'sh',
  0x37: 'sh',
  0x38: 's',
  0x39: 'h',
  0x58: 'q',
  0x59: 'kh',
  0x5a: 'g',
  0x5b: 'z',
  0x5c: 'r',
  0x5d: 'rh',
  0x5e: 'f',
  0x5f: 'y',
};

/** A consonant with a nukta under it, as in Hindi "zara" or "fasal". */
const NUKTA: Record<number, string> = {
  0x15: 'q',
  0x16: 'kh',
  0x17: 'g',
  0x1c: 'z',
  0x21: 'r',
  0x22: 'rh',
  0x2b: 'f',
  0x2f: 'y',
};

const VOWELS: Record<number, string> = {
  0x05: 'a',
  0x06: 'a',
  0x07: 'i',
  0x08: 'i',
  0x09: 'u',
  0x0a: 'u',
  0x0b: 'ri',
  0x0c: 'li',
  0x0d: 'e',
  0x0e: 'e',
  0x0f: 'e',
  0x10: 'ai',
  0x11: 'o',
  0x12: 'o',
  0x13: 'o',
  0x14: 'au',
  0x50: 'om',
  0x60: 'ri',
  0x61: 'li',
};

const VOWEL_SIGNS: Record<number, string> = {
  0x3e: 'a',
  0x3f: 'i',
  0x40: 'i',
  0x41: 'u',
  0x42: 'u',
  0x43: 'ri',
  0x44: 'ri',
  0x45: 'e',
  0x46: 'e',
  0x47: 'e',
  0x48: 'ai',
  0x49: 'o',
  0x4a: 'o',
  0x4b: 'o',
  0x4c: 'au',
  0x62: 'li',
  0x63: 'li',
};

/** Signs that add a sound after the vowel: anusvara, candrabindu, visarga, Gurmukhi tippi. */
const MODIFIERS: Record<number, string> = { 0x01: 'n', 0x02: 'n', 0x03: 'h', 0x70: 'n' };
/** Malayalam letters that end a syllable with no vowel (chillu), and Bengali khanda ta. */
const FINALS: Record<number, Record<number, string>> = {
  0x0d00: { 0x7a: 'n', 0x7b: 'n', 0x7c: 'r', 0x7d: 'l', 0x7e: 'l', 0x7f: 'k' },
  0x0980: { 0x4e: 't' },
};

/** Scripts where a word-final anusvara sounds "m": Malayalam "keralam", Telugu "telugam". */
const FINAL_ANUSVARA_M = new Set([0x0c00, 0x0c80, 0x0d00]);
const ANUSVARA = 0x02;
const VIRAMA = 0x4d;
const RA = 0x30;
const NUKTA_SIGN = 0x3c;

function indicBlock(code: number): number | null {
  const block = code & ~0x7f;
  return INDIC_BLOCKS.includes(block) ? block : null;
}

function transliterateIndic(text: string): string {
  let out = '';
  let pendingA = false;
  let syllables = 0;
  let lastConsonant: number | null = null;
  let afterVirama = false;
  let clusterEnd = false;
  let endsInAnusvara = false;
  let block: number | null = null;

  const endWord = () => {
    if (pendingA) {
      const drop = block !== null && DROPS_FINAL_A.has(block) && syllables > 1 && !clusterEnd;
      if (!drop) out += 'a';
    }
    if (endsInAnusvara && block !== null && FINAL_ANUSVARA_M.has(block)) {
      out = `${out.slice(0, -1)}m`;
    }
    endsInAnusvara = false;
    pendingA = false;
    syllables = 0;
    lastConsonant = null;
    afterVirama = false;
    clusterEnd = false;
  };
  const settle = () => {
    if (pendingA) out += 'a';
    pendingA = false;
  };

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const current = indicBlock(code);
    if (current === null) {
      endWord();
      block = null;
      out += ch;
      continue;
    }
    block = current;
    const offset = code - current;
    endsInAnusvara = false;
    const consonant = CONSONANTS[offset];
    const final = FINALS[current]?.[offset];
    if (consonant !== undefined) {
      settle();
      // A cluster keeps its final "a" (krishna, mitra), unless it starts with r (dharm, fark).
      clusterEnd = afterVirama && lastConsonant !== RA;
      afterVirama = false;
      out += consonant;
      lastConsonant = offset;
      pendingA = true;
      syllables++;
    } else if (offset === NUKTA_SIGN) {
      const base = lastConsonant === null ? undefined : CONSONANTS[lastConsonant];
      const replaced = lastConsonant === null ? undefined : NUKTA[lastConsonant];
      if (base !== undefined && replaced !== undefined && out.endsWith(base)) {
        out = out.slice(0, out.length - base.length) + replaced;
      }
    } else if (offset === VIRAMA) {
      pendingA = false;
      afterVirama = true;
    } else if (VOWEL_SIGNS[offset] !== undefined) {
      pendingA = false;
      out += VOWEL_SIGNS[offset];
    } else if (VOWELS[offset] !== undefined) {
      settle();
      out += VOWELS[offset];
      syllables++;
    } else if (MODIFIERS[offset] !== undefined) {
      settle();
      out += MODIFIERS[offset];
      endsInAnusvara = offset === ANUSVARA;
    } else if (final !== undefined) {
      settle();
      out += final;
    } else if (offset >= 0x66 && offset <= 0x6f) {
      endWord();
      out += String(offset - 0x66);
    } else if (offset === 0x64 || offset === 0x65) {
      endWord();
      out += ' ';
    }
  }
  endWord();
  return out;
}
