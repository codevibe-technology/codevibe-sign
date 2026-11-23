import { z } from 'zod';
import { gstinProblem, stateByCode } from './gst';

/** Who an invoice is made out to. India only: the state decides which GST applies. */
export interface BillingDetails {
  legalName: string;
  /** Upper case, or null for an unregistered buyer. */
  gstin: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  pin: string;
  /** GST state code, for example `06` for Haryana. */
  stateCode: string;
  email: string;
}

const line = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, `Keep this under ${max} characters`));

const optional = (max: number) => line(max).transform((value) => (value === '' ? null : value));

export const GSTIN_MESSAGES = {
  format: 'A GSTIN has 15 characters, for example 06AANCC6406C1ZX. Check it, or leave it empty.',
  checksum: 'This GSTIN does not pass its own check. One character is probably mistyped.',
  state: 'This GSTIN belongs to another state. Pick the state it was registered in.',
} as const;

/**
 * The fields of the billing details form, shared by the browser and the server. Each problem
 * names its field.
 */
export const billingDetailsShape = {
  legalName: line(160).pipe(z.string().min(2, 'Enter the legal name to print on invoices')),
  gstin: optional(15)
    .optional()
    .transform((value) => (value ? value.toUpperCase() : null)),
  addressLine1: line(160).pipe(z.string().min(3, 'Enter the billing address')),
  addressLine2: optional(160)
    .optional()
    .transform((value) => value ?? null),
  city: line(80).pipe(z.string().min(2, 'Enter the city')),
  pin: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter the 6 digit PIN code'),
  stateCode: z
    .string()
    .trim()
    .refine(
      (code) => stateByCode(code) !== undefined,
      'Pick a state or union territory of India. Invoices are issued for buyers in India only.',
    ),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter the email address invoices should go to').max(254)),
};

/** The GSTIN must be well formed and belong to the chosen state. Add it with `superRefine`. */
export function checkGstin(
  details: { gstin: string | null; stateCode: string },
  ctx: z.RefinementCtx,
): void {
  if (!details.gstin) return;
  const problem = gstinProblem(details.gstin, details.stateCode);
  if (problem) ctx.addIssue({ code: 'custom', path: ['gstin'], message: GSTIN_MESSAGES[problem] });
}

export const billingDetailsSchema = z.object(billingDetailsShape).superRefine(checkGstin);

export type BillingDetailsInput = z.input<typeof billingDetailsSchema>;
