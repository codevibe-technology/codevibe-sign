import 'server-only';
import type postgres from 'postgres';
import type { BillingDetails } from '@/lib/billing/details';
import type { InstallBooking } from '@/lib/billing/install-help';
import { formatInr } from '@/lib/billing/money';
import { randomId } from '../crypto';
import { AppError } from '../errors';
import { paymentsConfigured } from './config';
import { billingLimiter } from './limits';
import { createOrder, type BillingDeps, type CheckoutSession, type Fulfilment } from './orders';

const TEN_MINUTES = 10 * 60 * 1000;
/** Bookings one address may open, and all visitors together, in ten minutes. */
const PER_ADDRESS = 4;
const EVERYONE = 60;
const MAX_NOTIFY_ATTEMPTS = 8;

const SUMMARY = 'Codevibe Sign installation help';

/**
 * Counts one booking attempt. The form is public, so it is limited per address and, as a
 * backstop against many addresses, for everyone together.
 */
export async function enforceBookingLimit(ip: string | null, now = new Date()): Promise<void> {
  const limiter = billingLimiter();
  const own = await limiter.hit(`install:${ip ?? 'unknown'}`, PER_ADDRESS, TEN_MINUTES, now);
  const all = await limiter.hit('install:all', EVERYONE, TEN_MINUTES, now);
  if (!own.allowed || !all.allowed) {
    throw new AppError(
      'CONFLICT',
      'Too many bookings were started in a short time. Wait a few minutes and try again.',
    );
  }
}

/**
 * Stores a booking and opens its order. The price is the operator's; nothing about the
 * amount comes from the form.
 */
export async function createInstallBooking(
  sql: postgres.Sql,
  deps: BillingDeps,
  input: { booking: InstallBooking; ip?: string | null },
): Promise<{ bookingId: string; checkout: CheckoutSession }> {
  if (!paymentsConfigured(deps.config)) {
    throw new AppError('CONFLICT', 'Booking is not open yet.');
  }
  const { booking } = input;
  const buyer: BillingDetails = {
    legalName: booking.legalName,
    gstin: booking.gstin,
    addressLine1: booking.addressLine1,
    addressLine2: booking.addressLine2,
    city: booking.city,
    pin: booking.pin,
    stateCode: booking.stateCode,
    email: booking.email,
  };
  const bookingId = randomId('book');
  const { checkout } = await createOrder(sql, deps, {
    workspaceId: null,
    kind: 'install_help',
    lines: [{ description: SUMMARY, quantity: 1, unitPaise: deps.config.installHelpPaise }],
    payload: { bookingId },
    buyer,
    createdBy: null,
    summary: SUMMARY,
    ip: input.ip ?? null,
    // The booking is saved with its order or not at all, so no order can be paid without one.
    alongside: async (tx, orderId) => {
      await tx`
        insert into app_install_bookings (
          id, order_id, name, email, phone, company, provider, server_details, preferred_time
        ) values (
          ${bookingId}, ${orderId}, ${booking.name}, ${booking.email}, ${booking.phone},
          ${booking.legalName}, ${booking.provider}, ${booking.serverDetails},
          ${booking.preferredTime}
        )`;
    },
  });
  return { bookingId, checkout };
}

/** Paying marks the booking paid; the operator is told after the payment is saved. */
export const fulfilInstallHelp: Fulfilment = async (tx, order, { now }) => {
  const rows = await tx`
    update app_install_bookings set paid_at = ${now} where order_id = ${order.id} returning id`;
  if (rows.length !== 1) throw new Error(`Booking order ${order.id} has no booking`);
};

interface BookingRow {
  id: string;
  order_id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  provider: string;
  server_details: string;
  preferred_time: string;
  paid_at: Date;
  total_paise: string;
  mode: 'test' | 'live';
}

/**
 * Emails the operator about paid bookings they have not heard of yet. Each booking is
 * claimed first, so two processes send one email; a failed send is tried again later.
 * Without `OPERATOR_EMAIL` the bookings wait.
 */
export async function notifyInstallBookings(sql: postgres.Sql, deps: BillingDeps): Promise<number> {
  const to = deps.config.operatorEmail;
  if (!to) return 0;
  const now = deps.now();
  const stale = new Date(now.getTime() - 5 * 60_000);
  const rows = await sql<BookingRow[]>`
    update app_install_bookings b
    set notify_attempts = notify_attempts + 1, notify_claimed_at = ${now}
    from app_billing_orders o
    where o.id = b.order_id and b.paid_at is not null and b.notified_at is null
      and b.notify_attempts < ${MAX_NOTIFY_ATTEMPTS}
      and (b.notify_claimed_at is null or b.notify_claimed_at < ${stale})
    returning b.id, b.order_id, b.name, b.email, b.phone, b.company, b.provider,
      b.server_details, b.preferred_time, b.paid_at, o.total_paise, o.mode`;
  let sent = 0;
  for (const row of rows) {
    try {
      await deps.mailer.send({
        to,
        replyTo: row.email,
        subject: `${row.mode === 'test' ? '[Test] ' : ''}Installation help booked by ${row.name}`,
        text: [
          `A Codevibe Sign installation was booked and paid (${formatInr(Number(row.total_paise))}, GST included).`,
          ...(row.mode === 'test' ? ['This payment used test keys. No money was paid.'] : []),
          '',
          `Name: ${row.name}`,
          `Company: ${row.company}`,
          `Email: ${row.email}`,
          `Phone: ${row.phone}`,
          `Server: ${row.provider}`,
          `Preferred time: ${row.preferred_time}`,
          '',
          'Server details:',
          row.server_details,
          '',
          `Booking ${row.id}, order ${row.order_id}`,
        ].join('\n'),
        meta: { kind: 'install_help_booking' },
      });
      await sql`
        update app_install_bookings set notified_at = ${deps.now()}, notify_claimed_at = null
        where id = ${row.id}`;
      sent += 1;
    } catch (err) {
      await sql`update app_install_bookings set notify_claimed_at = null where id = ${row.id}`;
      console.error('[billing] booking notice', err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
