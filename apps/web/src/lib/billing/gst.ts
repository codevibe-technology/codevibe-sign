import type { Paise } from './money';

export interface IndianState {
  /** Two-digit GST state code, also the first two characters of a GSTIN. */
  code: string;
  name: string;
}

/** States and union territories with their GST codes. */
export const INDIAN_STATES: readonly IndianState[] = [
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' },
  { code: '10', name: 'Bihar' },
  { code: '04', name: 'Chandigarh' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '07', name: 'Delhi' },
  { code: '30', name: 'Goa' },
  { code: '24', name: 'Gujarat' },
  { code: '06', name: 'Haryana' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '20', name: 'Jharkhand' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '38', name: 'Ladakh' },
  { code: '31', name: 'Lakshadweep' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '27', name: 'Maharashtra' },
  { code: '14', name: 'Manipur' },
  { code: '17', name: 'Meghalaya' },
  { code: '15', name: 'Mizoram' },
  { code: '13', name: 'Nagaland' },
  { code: '21', name: 'Odisha' },
  { code: '34', name: 'Puducherry' },
  { code: '03', name: 'Punjab' },
  { code: '08', name: 'Rajasthan' },
  { code: '11', name: 'Sikkim' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '16', name: 'Tripura' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '19', name: 'West Bengal' },
];

const BY_CODE = new Map(INDIAN_STATES.map((state) => [state.code, state]));

export const stateByCode = (code: string): IndianState | undefined => BY_CODE.get(code);

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The check character of a GSTIN, from its first 14 characters (Luhn mod 36). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const value = GSTIN_ALPHABET.indexOf(first14[index]!);
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET[(36 - (sum % 36)) % 36]!;
}

export type GstinProblem = 'format' | 'checksum' | 'state';

/**
 * What is wrong with a GSTIN, or null when it is well formed: 15 characters in the GST layout,
 * a matching check character and, when `stateCode` is given, that state's code in front.
 */
export function gstinProblem(value: string, stateCode?: string): GstinProblem | null {
  const gstin = value.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin) || !BY_CODE.has(gstin.slice(0, 2))) return 'format';
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14]) return 'checksum';
  if (stateCode !== undefined && gstin.slice(0, 2) !== stateCode) return 'state';
  return null;
}

export interface TaxInput {
  taxablePaise: Paise;
  /** For example 18. Up to two decimals. */
  gstPercent: number;
  sellerStateCode: string;
  /** The place of supply: the buyer's state. */
  buyerStateCode: string;
}

export interface TaxBreakdown {
  /** `intra`: CGST and SGST, the buyer is in the seller's state. `inter`: IGST. */
  kind: 'intra' | 'inter';
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  /** Percent of each component that applies: half the rate twice, or the whole rate once. */
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
}

const halfUp = (numerator: number, denominator: number) =>
  Math.floor((numerator + denominator / 2) / denominator);

/**
 * GST on a taxable value. Each component is rounded half up to the paisa on its own, so CGST and
 * SGST are always equal and the total is the taxable value plus the components as printed.
 */
export function computeTax(input: TaxInput): TaxBreakdown {
  const { taxablePaise } = input;
  if (!Number.isSafeInteger(taxablePaise) || taxablePaise < 0) {
    throw new Error('taxablePaise must be a whole number of paise');
  }
  const basisPoints = Math.round(input.gstPercent * 100);
  if (input.sellerStateCode === input.buyerStateCode) {
    const half = halfUp(taxablePaise * basisPoints, 20_000);
    return {
      kind: 'intra',
      taxablePaise,
      cgstPaise: half,
      sgstPaise: half,
      igstPaise: 0,
      taxPaise: half * 2,
      totalPaise: taxablePaise + half * 2,
      cgstPercent: input.gstPercent / 2,
      sgstPercent: input.gstPercent / 2,
      igstPercent: 0,
    };
  }
  const igst = halfUp(taxablePaise * basisPoints, 10_000);
  return {
    kind: 'inter',
    taxablePaise,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: igst,
    taxPaise: igst,
    totalPaise: taxablePaise + igst,
    cgstPercent: 0,
    sgstPercent: 0,
    igstPercent: input.gstPercent,
  };
}
