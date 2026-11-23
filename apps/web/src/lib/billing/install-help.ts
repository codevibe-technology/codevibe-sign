import { z } from 'zod';
import { billingDetailsShape, checkGstin } from './details';

const text = (min: number, max: number, empty: string) =>
  z
    .string()
    .transform((value) => value.replace(/[ \t]+/g, ' ').trim())
    .pipe(z.string().min(min, empty).max(max, `Keep this under ${max} characters`));

/** Words that suggest someone is about to paste a credential into the form. */
const SECRET_HINT = /\b(password|passwd|pwd|private key|secret key|api key|token)\s*[:=]/i;

/**
 * The installation help booking form, shared by the browser and the server. The billing
 * fields are the same ones a workspace fills in, so the invoice rules are the same too.
 */
export const installBookingSchema = z
  .object({
    name: text(2, 80, 'Enter your name'),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 -]{7,17}$/, 'Enter a phone number we can reach you on'),
    ...billingDetailsShape,
    provider: text(2, 80, 'Say where the server is, for example Hostinger, AWS or your office'),
    serverDetails: text(
      10,
      1000,
      'Describe the server: operating system, memory and the domain you want to use',
    ).refine(
      (value) => !SECRET_HINT.test(value),
      'Do not put passwords or keys here. We arrange access with you safely after booking.',
    ),
    preferredTime: text(3, 120, 'Say when suits you, for example a date and a time in IST'),
  })
  .superRefine(checkGstin);

export type InstallBookingInput = z.input<typeof installBookingSchema>;
export type InstallBooking = z.output<typeof installBookingSchema>;

/** Working hours within which the installation is done once access is in place. */
export const INSTALL_HELP_HOURS = 4;
