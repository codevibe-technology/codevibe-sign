import { describe, expect, it } from 'vitest';
import { billingDetailsSchema } from './details';
import { INDIAN_STATES, computeTax, gstinCheckCharacter, gstinProblem } from './gst';
import { financialYearStart, invoiceNumber, seriesPrefix, seriesProblem } from './invoice-series';
import { amountInWords, formatInr, formatInrFixed, numberInWords, parseInr } from './money';

describe('money', () => {
  it('reads rupee amounts as whole paise', () => {
    expect(parseInr('25')).toBe(2500);
    expect(parseInr('24.5')).toBe(2450);
    expect(parseInr('24.99')).toBe(2499);
    expect(parseInr(' 0.05 ')).toBe(5);
    for (const bad of ['', '-1', '1.999', '1,000', 'ten', '1e3', '.5']) {
      expect(parseInr(bad), bad).toBeNull();
    }
  });

  it('formats with Indian grouping and paise only when there are any', () => {
    expect(formatInr(3500)).toBe('₹35');
    expect(formatInr(3550)).toBe('₹35.50');
    expect(formatInr(11_800_000)).toBe('₹1,18,000');
    expect(formatInrFixed(118_000)).toBe('1,180.00');
    expect(formatInrFixed(5)).toBe('0.05');
  });

  it('writes amounts in words with lakh and crore', () => {
    expect(numberInWords(0)).toBe('Zero');
    expect(numberInWords(19)).toBe('Nineteen');
    expect(numberInWords(100_000)).toBe('One Lakh');
    expect(numberInWords(12_345_678)).toBe(
      'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight',
    );
    expect(amountInWords(41_300)).toBe('Rupees Four Hundred Thirteen Only');
    expect(amountInWords(118_050)).toBe(
      'Rupees One Thousand One Hundred Eighty and Fifty Paise Only',
    );
    expect(amountInWords(7)).toBe('Rupees Zero and Seven Paise Only');
  });
});

describe('GST', () => {
  const tax = (taxablePaise: number, buyerStateCode: string, gstPercent = 18) =>
    computeTax({ taxablePaise, gstPercent, sellerStateCode: '06', buyerStateCode });

  it('splits into CGST and SGST for a buyer in the seller state', () => {
    expect(tax(35_000, '06')).toMatchObject({
      kind: 'intra',
      cgstPaise: 3150,
      sgstPaise: 3150,
      igstPaise: 0,
      taxPaise: 6300,
      totalPaise: 41_300,
      cgstPercent: 9,
      sgstPercent: 9,
    });
  });

  it('charges IGST for a buyer in another state', () => {
    expect(tax(35_000, '27')).toMatchObject({
      kind: 'inter',
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 6300,
      totalPaise: 41_300,
      igstPercent: 18,
    });
  });

  it('rounds each component half up to the paisa', () => {
    // 24.99 x 10 = 249.90; 18% = 44.982, 9% = 22.491.
    expect(tax(24_990, '27').igstPaise).toBe(4498);
    expect(tax(24_990, '06')).toMatchObject({
      cgstPaise: 2249,
      sgstPaise: 2249,
      totalPaise: 29_488,
    });
    // 9% of 0.50 is 0.045 and rounds up; 18% of 0.25 is 0.045 and rounds up.
    expect(tax(50, '06')).toMatchObject({ cgstPaise: 5, sgstPaise: 5, totalPaise: 60 });
    expect(tax(25, '27')).toMatchObject({ igstPaise: 5, totalPaise: 30 });
    // 1 paisa: 0.18 and 0.09 both round down.
    expect(tax(1, '27').igstPaise).toBe(0);
    expect(tax(1, '06').taxPaise).toBe(0);
    // An odd taxable value where the two halves add up to one paisa more than IGST would.
    expect(tax(1675, '06')).toMatchObject({ cgstPaise: 151, sgstPaise: 151, totalPaise: 1977 });
    expect(tax(1675, '27')).toMatchObject({ igstPaise: 302, totalPaise: 1977 });
    expect(tax(25, '06')).toMatchObject({ cgstPaise: 2, sgstPaise: 2, totalPaise: 29 });
  });

  it('always totals to the taxable value plus the printed components', () => {
    for (let paise = 1; paise < 3000; paise += 7) {
      for (const state of ['06', '29']) {
        const t = tax(paise, state);
        expect(t.totalPaise).toBe(t.taxablePaise + t.cgstPaise + t.sgstPaise + t.igstPaise);
        expect(t.cgstPaise).toBe(t.sgstPaise);
      }
    }
  });

  it('refuses amounts that are not whole paise', () => {
    expect(() => tax(10.5, '06')).toThrow();
    expect(() => tax(-1, '06')).toThrow();
  });

  it('lists every state and union territory once', () => {
    expect(INDIAN_STATES).toHaveLength(36);
    expect(new Set(INDIAN_STATES.map((s) => s.code)).size).toBe(36);
  });

  it('checks a GSTIN by layout, check character and state', () => {
    expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V');
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull();
    expect(gstinProblem('06AANCC6406C1ZX')).toBeNull();
    expect(gstinProblem('06aancc6406c1zx', '06')).toBeNull();
    expect(gstinProblem('06AANCC6406C1ZY')).toBe('checksum');
    expect(gstinProblem('06AANCC6406C1ZX', '27')).toBe('state');
    expect(gstinProblem('99AANCC6406C1ZX')).toBe('format');
    expect(gstinProblem('06AANCC6406C1Z')).toBe('format');
    expect(gstinProblem('not a gstin')).toBe('format');
  });
});

describe('invoice series', () => {
  it('takes the financial year from the date in India', () => {
    expect(financialYearStart(new Date('2026-11-23T10:00:00Z'))).toBe(2026);
    // 31 March 2027, 23:59 IST is still 2026-27; one minute later is 2027-28.
    expect(financialYearStart(new Date('2027-03-31T18:29:00Z'))).toBe(2026);
    expect(financialYearStart(new Date('2027-03-31T18:30:00Z'))).toBe(2027);
    expect(financialYearStart(new Date('2027-01-01T00:00:00Z'))).toBe(2026);
  });

  it('renders numbers such as CVS-2026-0001', () => {
    const prefix = seriesPrefix('CVS-{FY}-', new Date('2026-11-23T10:00:00Z'));
    expect(prefix).toBe('CVS-2026-');
    expect(invoiceNumber(prefix, 1)).toBe('CVS-2026-0001');
    expect(invoiceNumber(prefix, 12_345)).toBe('CVS-2026-12345');
    expect(seriesPrefix('INV/', new Date())).toBe('INV/');
  });

  it('refuses a series that breaks the 16 character rule or has other characters', () => {
    expect(seriesProblem('CVS-{FY}-')).toBeNull();
    expect(seriesProblem('CODEVIBE-{FY}-')).toMatch(/longer than 16/);
    expect(seriesProblem('CVS {FY}')).toMatch(/letters, digits/);
    expect(seriesProblem('CVS-{YEAR}-')).toMatch(/letters, digits/);
  });
});

describe('billing details', () => {
  const valid = {
    legalName: '  Acme   Traders Private Limited ',
    gstin: '06aancc6406c1zx',
    addressLine1: '12 MG Road',
    addressLine2: '',
    city: 'Gurugram',
    pin: '122001',
    stateCode: '06',
    email: 'Accounts@Acme.example',
  };

  it('cleans what was typed', () => {
    expect(billingDetailsSchema.parse(valid)).toEqual({
      legalName: 'Acme Traders Private Limited',
      gstin: '06AANCC6406C1ZX',
      addressLine1: '12 MG Road',
      addressLine2: null,
      city: 'Gurugram',
      pin: '122001',
      stateCode: '06',
      email: 'accounts@acme.example',
    });
    expect(billingDetailsSchema.parse({ ...valid, gstin: '' }).gstin).toBeNull();
  });

  it.each([
    [{ gstin: '06AANCC6406C1ZY' }, 'gstin', /does not pass/],
    [{ gstin: '06AANCC6406C1ZX', stateCode: '27' }, 'gstin', /another state/],
    [{ gstin: 'ABC' }, 'gstin', /15 characters/],
    [{ stateCode: 'XX' }, 'stateCode', /India only/],
    [{ pin: '12200' }, 'pin', /6 digit/],
    [{ email: 'nope' }, 'email', /email address/],
    [{ legalName: ' ' }, 'legalName', /legal name/],
  ])('points at the field for %j', (change, field, message) => {
    const result = billingDetailsSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect(issue.path.join('.')).toBe(field);
    expect(issue.message).toMatch(message);
  });
});
