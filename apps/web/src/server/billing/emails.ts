import { formatIstDate } from '@/lib/billing/invoice-series';
import { formatInr } from '@/lib/billing/money';
import {
  renderEmail,
  standardLinks,
  type EmailBody,
  type EmailDetail,
  type EmailSpec,
} from '@/lib/email-layout';
import type { SellerConfig } from './config';
import type { BillingOrder } from './orders';

/**
 * The billing emails as subject, HTML and text, apart from the code that decides when they go
 * out, so each can be checked and previewed on its own.
 */

export interface BillingMail extends EmailBody {
  subject: string;
}

/** The app's public URL, which serves the logo and the pages the emails link to. */
type AppUrl = string;

/** Where the app runs when a caller gives no URL: the default of APP_URL. */
export const appUrlOf = (deps: { appUrl?: string | undefined }): AppUrl =>
  deps.appUrl ?? 'http://localhost:3000';

const sellerLine = (seller: Pick<SellerConfig, 'name' | 'address'>) =>
  `${seller.name}, ${seller.address.replace(/\s*\n\s*/g, ', ')}`;

function codevibe(
  appUrl: AppUrl,
  spec: Omit<EmailSpec, 'appUrl' | 'header' | 'footer'> & { reason: string; org?: string | null },
): EmailBody {
  const { reason, org, ...rest } = spec;
  return renderEmail({
    ...rest,
    appUrl,
    header: { kind: 'codevibe' },
    footer: { reason, lines: org ? [org] : [], links: standardLinks(appUrl) },
  });
}

/** The tax invoice for one payment; the PDF goes with it as an attachment. */
export function invoiceEmail(
  invoice: { number: string; issuedAt: Date; order: BillingOrder },
  appUrl: AppUrl,
): BillingMail {
  const { order } = invoice;
  const test = order.mode === 'test';
  const what = test ? 'Test invoice' : 'Tax invoice';
  const date = formatIstDate(invoice.issuedAt);
  const total = formatInr(order.tax.totalPaise);
  const details: EmailDetail[] = [
    { label: 'Invoice', value: invoice.number },
    { label: 'Date', value: date },
    { label: 'Items', value: order.lines.map((line) => line.description).join('\n') },
    { label: 'Total paid', value: `${total}, GST included` },
    ...(order.razorpayPaymentId
      ? [{ label: 'Payment reference', value: order.razorpayPaymentId }]
      : []),
  ];
  const body = codevibe(appUrl, {
    preheader: `${what} ${invoice.number} for ${total} is attached.`,
    heading: 'Thank you for your payment',
    paragraphs: ['Hello,', `${what} ${invoice.number} dated ${date} is attached as a PDF.`],
    details,
    button: { label: 'Open Codevibe Sign', href: `${appUrl}/dashboard` },
    notes: [
      ...(test ? ['This payment used test keys. No money was paid.'] : []),
      'Keep the invoice for your records. Every invoice is also in Settings, then Billing, in your workspace.',
    ],
    reason: `You got this email because you paid ${order.seller.name} for Codevibe Sign.`,
    org: sellerLine(order.seller),
  });
  return { subject: `${what} ${invoice.number} from ${order.seller.name}`, ...body };
}

export type SubscriptionMailKind =
  | 'subscription_reminder'
  | 'subscription_grace'
  | 'subscription_ended';

/** A notice about the account's Cloud term, to its owner and billing contact. */
export function subscriptionEmail(
  message: { subject: string; heading: string; lines: string[]; details?: EmailDetail[] },
  seller: Pick<SellerConfig, 'name' | 'address'> | null,
  appUrl: AppUrl,
): BillingMail {
  const body = codevibe(appUrl, {
    preheader: message.lines[0]!,
    heading: message.heading,
    paragraphs: ['Hello,', ...message.lines],
    ...(message.details ? { details: message.details } : {}),
    button: { label: 'Open Plan and usage', href: `${appUrl}/dashboard` },
    notes: ['Open any of your workspaces, then Settings, then Plan and usage.'],
    reason:
      'You got this email because you own this Codevibe Sign account or are its billing contact.',
    org: seller ? sellerLine(seller) : null,
  });
  return { subject: message.subject, ...body };
}

/** A note to the operator about money that needs a person: what happened and what to do. */
export function operatorEmail(
  note: {
    subject: string;
    advice: string;
    test: boolean;
    details: EmailDetail[];
    paymentId: string | null;
  },
  appUrl: AppUrl,
): BillingMail {
  const href = note.paymentId
    ? `https://dashboard.razorpay.com/app/payments/${encodeURIComponent(note.paymentId)}`
    : 'https://dashboard.razorpay.com/app/payments';
  const body = codevibe(appUrl, {
    preheader: note.advice,
    heading: note.subject,
    paragraphs: [
      `${note.subject}.`,
      note.advice,
      ...(note.test ? ['This payment used test keys. No money moved.'] : []),
    ],
    details: note.details,
    button: { label: 'Open in Razorpay', href },
    reason:
      'You got this email because this address is the operator address (OPERATOR_EMAIL) of this Codevibe Sign install.',
  });
  return { subject: `${note.test ? '[Test] ' : ''}${note.subject}`, ...body };
}

/** To the operator: someone booked and paid for installation help. */
export function installBookingEmail(
  booking: {
    id: string;
    orderId: string;
    name: string;
    email: string;
    phone: string;
    company: string;
    provider: string;
    serverDetails: string;
    preferredTime: string;
    totalPaise: number;
    test: boolean;
  },
  appUrl: AppUrl,
): BillingMail {
  const body = codevibe(appUrl, {
    preheader: `${booking.name} of ${booking.company} booked installation help.`,
    heading: 'Installation help booked',
    paragraphs: [
      `A Codevibe Sign installation was booked and paid (${formatInr(booking.totalPaise)}, GST included).`,
      ...(booking.test ? ['This payment used test keys. No money was paid.'] : []),
      'Reply to this email to reach the customer.',
    ],
    details: [
      { label: 'Name', value: booking.name },
      { label: 'Company', value: booking.company },
      { label: 'Email', value: booking.email },
      { label: 'Phone', value: booking.phone },
      { label: 'Server', value: booking.provider },
      { label: 'Preferred time', value: booking.preferredTime },
      { label: 'Server details', value: booking.serverDetails },
      { label: 'Booking', value: `${booking.id}, order ${booking.orderId}` },
    ],
    button: { label: `Email ${booking.name}`, href: `mailto:${booking.email}` },
    reason:
      'You got this email because this address is the operator address (OPERATOR_EMAIL) of this Codevibe Sign install.',
  });
  return {
    subject: `${booking.test ? '[Test] ' : ''}Installation help booked by ${booking.name}`,
    ...body,
  };
}
