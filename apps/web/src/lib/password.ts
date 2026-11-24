/** Long enough that length does the work; no rules about symbols or capitals. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters. A few unrelated words work well.`;

/** Words that passwords are built from too often to be worth anything, however decorated. */
const BASE_WORDS = new Set([
  'password',
  'passwort',
  'passcode',
  'welcome',
  'qwerty',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  'letmein',
  'admin',
  'administrator',
  'iloveyou',
  'sunshine',
  'football',
  'cricket',
  'monkey',
  'dragon',
  'superman',
  'batman',
  'princess',
  'master',
  'login',
  'hello',
  'secret',
  'changeme',
  'default',
  'india',
  'codevibe',
  'codevibesign',
  'trustno',
  'abc',
  'abcd',
  'test',
  'testing',
  'guest',
  'user',
]);

const ROWS = [
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1q2w3e4r5t6y7u8i9o0p',
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm',
];

const LEET: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '3': 'e',
  $: 's',
  '5': 's',
  '7': 't',
};

/** One short piece said over and over: `aaaaaaaaaa`, `1212121212`, `abcabcabcabc`. */
function isRepeated(value: string): boolean {
  for (let size = 1; size <= 4; size++) {
    if (value.length >= size * 2 && value === value.slice(0, size).repeat(value.length / size)) {
      return value.length % size === 0;
    }
  }
  return false;
}

/** A straight run along the keyboard or the alphabet, forwards or backwards. */
function isRun(value: string): boolean {
  const reversed = [...value].reverse().join('');
  return ROWS.some((row) => {
    const twice = row + row;
    return twice.includes(value) || twice.includes(reversed);
  });
}

/** `P@ssw0rd123!` and `Welcome@2026` are still "password" and "welcome". */
function isDecoratedWord(value: string): boolean {
  const core = value.replace(/^[^a-z]+|[^a-z@$!]+$/g, '').replace(/[\d\W_]+$/g, '');
  const plain = [...core].map((char) => LEET[char] ?? char).join('');
  const letters = (text: string) => text.replace(/[^a-z]/g, '');
  const candidates = [core, plain, letters(core), letters(plain)];
  return candidates.some((candidate) => {
    if (BASE_WORDS.has(candidate)) return true;
    const half = candidate.slice(0, candidate.length / 2);
    return candidate.length % 2 === 0 && half + half === candidate && BASE_WORDS.has(half);
  });
}

/**
 * Why a password is not acceptable, as a sentence for the person choosing it, or null when it
 * is. The rules: long enough, not one of the passwords everyone tries first, and not built
 * from the account's own email or name.
 */
export function passwordProblem(
  password: string,
  account: { email?: string | null; name?: string | null } = {},
): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const value = password.toLowerCase();
  if (isRepeated(value) || isRun(value) || isDecoratedWord(value)) {
    return 'That password is one of the first anyone would guess. Pick something less common.';
  }
  const email = account.email?.trim().toLowerCase() ?? '';
  const own = [email, email.split('@')[0] ?? '', account.name?.trim().toLowerCase() ?? ''].filter(
    (part) => part.length >= 4,
  );
  if (own.some((part) => value.includes(part.replace(/\s+/g, '')) || value.includes(part))) {
    return 'Do not build the password from your email address or name.';
  }
  return null;
}

export interface PasswordStrength {
  /** 0 nothing typed, 1 not accepted, 2 acceptable, 3 good, 4 strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

/**
 * How strong a password looks, for the meter under a new password. Anything `passwordProblem`
 * refuses is "Too weak", so the meter never praises a password the form will reject. Above
 * that, length counts most, then a mix of kinds of character.
 */
export function passwordStrength(
  password: string,
  account: { email?: string | null; name?: string | null } = {},
): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  if (passwordProblem(password, account)) return { score: 1, label: 'Too weak' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((kind) => kind.test(password));
  const length = password.length;
  if (length >= 20 || (length >= 16 && kinds.length >= 3)) return { score: 4, label: 'Strong' };
  if (length >= 14 || kinds.length >= 3) return { score: 3, label: 'Good' };
  return { score: 2, label: 'Fair' };
}
