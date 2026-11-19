import type { SealSigner } from '@codevibe_technology/sign-pdf';

const PDF_MAGIC = '%PDF-';

/** PDF readers accept the header anywhere in the first kilobyte. */
export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes(PDF_MAGIC);
}

export function formatTime(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC');
}

export function signerName(signer: SealSigner): string {
  const { commonName, organization } = signer;
  if (commonName && organization && commonName !== organization) {
    return `${commonName} (${organization})`;
  }
  return commonName ?? organization ?? 'unknown';
}

const PAPER: [string, number, number][] = [
  ['A3', 842, 1191],
  ['A4', 595, 842],
  ['A5', 420, 595],
  ['Letter', 612, 792],
  ['Legal', 612, 1008],
];

/** `595 x 842 pt (A4)`, naming common paper sizes in either orientation. */
export function pageSize(width: number, height: number): string {
  const w = Math.round(width);
  const h = Math.round(height);
  const paper = PAPER.find(
    ([, a, b]) =>
      (Math.abs(w - a) <= 1 && Math.abs(h - b) <= 1) ||
      (Math.abs(w - b) <= 1 && Math.abs(h - a) <= 1),
  );
  const name = paper ? ` (${paper[0]}${w > h ? ', landscape' : ''})` : '';
  return `${w} x ${h} pt${name}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
