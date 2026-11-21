import { describe, expect, it } from 'vitest';
import { EXCLUDED_DOCUMENTS, looksExcluded } from './excluded-documents';

describe('documents the IT Act leaves out', () => {
  it.each([
    'Last Will and Testament.pdf',
    'Will of R Sharma',
    'codicil_2026.pdf',
    'Family trust deed.pdf',
    'General_Power_of_Attorney.pdf',
    'POA for bank',
    'Demand promissory note',
    'bill-of-exchange.pdf',
  ])('spots %s', (name) => {
    expect(looksExcluded([name])).toBe(true);
  });

  it.each([
    'Offer letter.pdf',
    'What we will do next quarter',
    'Will you sign the NDA',
    'Trusted vendor agreement',
    'Sale deed draft.pdf',
    'Share purchase agreement',
    '',
  ])('leaves %s alone', (name) => {
    expect(looksExcluded([name])).toBe(false);
  });

  it('checks every name it is given', () => {
    expect(looksExcluded(['Offer letter', 'Power of attorney.pdf'])).toBe(true);
  });

  it('lists only what is still excluded, without dashes', () => {
    const text = EXCLUDED_DOCUMENTS.join(' ');
    expect(text).not.toMatch(/immovable|sale deed/i);
    expect(text).not.toMatch(/[–—]/);
  });
});
