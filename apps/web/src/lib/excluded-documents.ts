/**
 * Documents the Information Technology Act 2000 still leaves out (section 1(4) and the First
 * Schedule, as amended by S.O. 4720(E) of 26 September 2022), in plain words.
 */
export const EXCLUDED_DOCUMENTS = [
  'Wills, codicils and other testamentary dispositions',
  'Trust deeds',
  'Powers of attorney, unless they let an RBI, NHB, SEBI, IRDAI or PFRDA regulated entity act for you',
  'Negotiable instruments other than cheques, such as promissory notes and bills of exchange, unless issued in favour of or endorsed by such a regulated entity',
] as const;

const PATTERNS: RegExp[] = [
  /\b(last will|will and testament|will deed|testament|testamentary|codicil|probate)\b/i,
  /^\s*(my\s+)?will\b(?!\s+(be|do|we|you|they|i)\b)/i,
  /\b(trust deed|deed of trust|declaration of trust|trust agreement|private trust|family trust)\b/i,
  /\b(power of attorney|powers of attorney|poa|general power|special power)\b/i,
  /\b(promissory note|pro ?note|dpn|bill of exchange|hundi)\b/i,
];

/** "power_of_attorney-v2.pdf" reads as "power of attorney v2". */
const words = (text: string) =>
  text
    .replace(/\.pdf$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ');

/**
 * Whether a document name or envelope title looks like a document the IT Act does not cover.
 * Only a hint for a notice: it reads names, never the file.
 */
export function looksExcluded(names: string[]): boolean {
  return names.some((name) => {
    const text = words(name);
    return text.trim() !== '' && PATTERNS.some((pattern) => pattern.test(text));
  });
}
