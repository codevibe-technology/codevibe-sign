import { describe, expect, it } from 'vitest';
import { formatBytes, formatTime, isPdf, pageSize, signerName } from './format';

describe('format', () => {
  it('names common paper sizes in either orientation', () => {
    expect(pageSize(595.28, 841.89)).toBe('595 x 842 pt (A4)');
    expect(pageSize(841.89, 595.28)).toBe('842 x 595 pt (A4, landscape)');
    expect(pageSize(612, 1008)).toBe('612 x 1008 pt (Legal)');
    expect(pageSize(300, 300)).toBe('300 x 300 pt');
  });

  it('finds the PDF header within the first kilobyte only', () => {
    expect(isPdf(Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(isPdf(Buffer.from(`${' '.repeat(100)}%PDF-1.4`))).toBe(true);
    expect(isPdf(Buffer.from(`${' '.repeat(1024)}%PDF-1.4`))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });

  it('formats times, sizes and signer names', () => {
    expect(formatTime('2026-11-20T10:21:04.000Z')).toBe('2026-11-20 10:21:04 UTC');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(signerName({ commonName: 'Seal', organization: 'Acme' })).toBe('Seal (Acme)');
    expect(signerName({ commonName: 'Acme', organization: 'Acme' })).toBe('Acme');
    expect(signerName({})).toBe('unknown');
  });
});
