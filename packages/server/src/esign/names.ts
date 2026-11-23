/** Lowercase words without accents or punctuation: "Prakriti S. Iyer" is prakriti, s, iyer. */
function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/**
 * Whether the name on a signer's eSign certificate is the recipient's name, give or take
 * case, spacing, punctuation, word order and initials: "Prakriti Iyer" and "PRAKRITI S IYER"
 * match, "Shubham Dhall" and "Prakriti S Iyer" do not. The full words of one name must all
 * be in the other, and an initial must be in the other name or stand for one of its
 * remaining words, unless none are left, as with a middle initial only one of them carries.
 */
export function namesMatch(recipientName: string, certificateName: string): boolean {
  const a = words(recipientName);
  const b = words(certificateName);
  if (a.length === 0 || b.length === 0) return true;
  const full = (list: string[]) => list.filter((w) => w.length > 1);
  const [fewer, more] = full(a).length <= full(b).length ? [a, b] : [b, a];
  if (full(fewer).length === 0) return false;
  if (!full(fewer).every((w) => more.includes(w))) return false;
  const initialsFit = (side: string[], other: string[]) => {
    const left = other.filter((w) => w.length > 1 && !side.includes(w));
    return side
      .filter((w) => w.length === 1)
      .every(
        (initial) =>
          other.includes(initial) || left.length === 0 || left.some((w) => w.startsWith(initial)),
      );
  };
  return initialsFit(a, b) && initialsFit(b, a);
}
