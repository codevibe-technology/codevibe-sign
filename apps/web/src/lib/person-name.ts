export const PERSON_NAME_MIN = 2;
export const PERSON_NAME_MAX = 80;

// Control characters, line and paragraph separators, and the marks that reorder text: none
// belongs in a name, and the last group can make one name read as another.
const UNSAFE = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;
const LETTER = /\p{L}/u;

export type PersonNameResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * The one rule for a person's own name: trimmed, inner runs of spaces collapsed, 2 to 80
 * characters, letters of any script, and no control characters. Length counts characters as
 * people see them typed (code points), so a name in Devanagari is not cut short.
 */
export function parsePersonName(raw: string): PersonNameResult {
  if (UNSAFE.test(raw)) {
    return { ok: false, error: 'The name has characters that cannot be used. Type it again' };
  }
  const name = raw.replace(/\s+/gu, ' ').trim();
  if (!name) return { ok: false, error: 'Enter your name' };
  const length = Array.from(name).length;
  if (length < PERSON_NAME_MIN) {
    return { ok: false, error: `Enter the full name, at least ${PERSON_NAME_MIN} characters` };
  }
  if (length > PERSON_NAME_MAX) {
    return { ok: false, error: `Keep the name to ${PERSON_NAME_MAX} characters or fewer` };
  }
  if (!LETTER.test(name)) return { ok: false, error: 'A name needs at least one letter' };
  return { ok: true, name };
}

/** Why a name is not acceptable, as a sentence for the form, or null when it is. */
export function personNameProblem(raw: string): string | null {
  const result = parsePersonName(raw);
  return result.ok ? null : result.error;
}

export function hasName(person: { name?: string | null }): boolean {
  return Boolean(person.name?.trim());
}

/** What to call someone: their name, or their email address only when they have saved none. */
export function displayName(person: { name?: string | null; email: string }): string {
  return person.name?.trim() || person.email;
}

/** The letter for an avatar. */
export function initialOf(person: { name?: string | null; email: string }): string {
  return (Array.from(displayName(person))[0] ?? '').toUpperCase();
}
