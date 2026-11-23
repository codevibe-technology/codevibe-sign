import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  human: { ok: true } as
    | { ok: true }
    | { ok: false; reason: 'missing' | 'rejected' | 'unavailable' },
  tokens: [] as (string | null | undefined)[],
  created: 0,
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../db', () => ({ db: () => ({}) }));
vi.mock('../client-address', () => ({ clientAddress: () => '203.0.113.7' }));
vi.mock('../plans', () => ({ isHosted: () => true }));
vi.mock('../billing/runtime', () => ({ billingDeps: () => ({}) }));
vi.mock('../billing/orders', () => ({ confirmCheckout: vi.fn(), unappliedMessage: vi.fn() }));
vi.mock('../billing/install-help', () => ({
  enforceBookingLimit: async () => undefined,
  notifyInstallBookings: async () => undefined,
  createInstallBooking: async () => {
    state.created += 1;
    return { bookingId: 'b1', checkout: { orderId: 'order_1' } };
  },
}));
vi.mock('../human-check', async () => {
  const { AppError } = await import('../errors');
  const { humanCheckMessage } = await import('@/lib/human-check');
  return {
    requireHuman: async (token: string | null | undefined) => {
      state.tokens.push(token);
      if (!state.human.ok) throw new AppError('HUMAN_CHECK', humanCheckMessage(state.human.reason));
    },
  };
});

const { bookInstallHelpAction } = await import('./install-help');

const booking = {
  name: 'Asha Rao',
  phone: '+91 98765 43210',
  email: 'asha@example.com',
  legalName: 'Acme Private Limited',
  gstin: '',
  addressLine1: '12 MG Road',
  addressLine2: '',
  city: 'Bengaluru',
  pin: '560001',
  stateCode: '29',
  provider: 'Hostinger',
  serverDetails: 'Ubuntu 24.04, 4 GB memory, sign.acme.in',
  preferredTime: 'Monday 11 am IST',
};

beforeEach(() => {
  state.human = { ok: true };
  state.tokens = [];
  state.created = 0;
});

describe('bookInstallHelpAction', () => {
  it('checks the browser token before storing the booking', async () => {
    expect(await bookInstallHelpAction(booking, 'token-1')).toEqual({
      ok: true,
      data: { orderId: 'order_1' },
    });
    expect(state.tokens).toEqual(['token-1']);
    expect(state.created).toBe(1);
  });

  it('stores nothing and says what to do when the check fails', async () => {
    state.human = { ok: false, reason: 'rejected' };
    expect(await bookInstallHelpAction(booking, 'stale')).toMatchObject({
      ok: false,
      code: 'HUMAN_CHECK',
      error: expect.stringContaining('Try again'),
    });
    state.human = { ok: false, reason: 'missing' };
    expect(await bookInstallHelpAction(booking)).toMatchObject({ ok: false, code: 'HUMAN_CHECK' });
    expect(state.created).toBe(0);
  });

  it('checks the form before spending the token', async () => {
    expect(await bookInstallHelpAction({ ...booking, name: '' }, 'token-1')).toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });
    expect(state.tokens).toEqual([]);
  });
});
