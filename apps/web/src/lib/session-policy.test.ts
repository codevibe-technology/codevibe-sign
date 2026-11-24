import { describe, expect, it } from 'vitest';
import {
  defaultSessionPolicy,
  needsTouch,
  sessionExpiry,
  sessionIsLive,
  sessionPolicy,
} from './session-policy';

const at = (iso: string) => new Date(`2026-11-24T${iso}Z`);

describe('sessionPolicy', () => {
  it('defaults to 30 idle minutes inside a 12-hour day', () => {
    expect(defaultSessionPolicy()).toEqual({
      idleSeconds: 1800,
      maxSeconds: 43_200,
      touchSeconds: 60,
      warningSeconds: 120,
    });
  });

  it('turns idle sign-out off with 0, leaving only the lifetime cap', () => {
    expect(sessionPolicy({ idleMinutes: 0, maxHours: 24 })).toEqual({
      idleSeconds: null,
      maxSeconds: 86_400,
      touchSeconds: 0,
      warningSeconds: 0,
    });
  });

  it('never lets the idle limit outlast the cap', () => {
    expect(sessionPolicy({ idleMinutes: 600, maxHours: 2 }).idleSeconds).toBe(7200);
  });

  it('shrinks the warning and the write interval for a very short limit', () => {
    expect(sessionPolicy({ idleMinutes: 1, maxHours: 1 })).toMatchObject({
      idleSeconds: 60,
      touchSeconds: 15,
      warningSeconds: 30,
    });
  });
});

describe('sessionExpiry', () => {
  const policy = defaultSessionPolicy();

  it('is the idle limit from the last activity', () => {
    expect(sessionExpiry(policy, at('08:00:00'), at('09:10:00'))).toEqual(at('09:40:00'));
  });

  it('stops at the lifetime cap however recent the activity', () => {
    expect(sessionExpiry(policy, at('08:00:00'), at('19:50:00'))).toEqual(at('20:00:00'));
  });

  it('is the cap alone when idle sign-out is off', () => {
    const off = sessionPolicy({ idleMinutes: 0, maxHours: 12 });
    expect(sessionExpiry(off, at('08:00:00'), at('08:05:00'))).toEqual(at('20:00:00'));
  });
});

describe('sessionIsLive', () => {
  const policy = defaultSessionPolicy();
  const session = (updatedAt: string, expiresAt = '23:00:00') => ({
    createdAt: at('08:00:00'),
    updatedAt: at(updatedAt),
    expiresAt: at(expiresAt),
  });

  it('holds while the last activity is inside the idle limit', () => {
    expect(sessionIsLive(policy, session('09:00:00'), at('09:29:59'))).toBe(true);
  });

  it('ends after the idle limit even when the stored expiry is later', () => {
    expect(sessionIsLive(policy, session('09:00:00'), at('09:30:00'))).toBe(false);
  });

  it('ends at the cap and at the stored expiry', () => {
    expect(sessionIsLive(policy, session('19:59:00'), at('20:00:00'))).toBe(false);
    expect(sessionIsLive(policy, session('09:00:00', '09:10:00'), at('09:10:00'))).toBe(false);
  });
});

describe('needsTouch', () => {
  const policy = defaultSessionPolicy();

  it('writes at most once a minute', () => {
    expect(needsTouch(policy, at('09:00:00'), at('09:00:59'))).toBe(false);
    expect(needsTouch(policy, at('09:00:00'), at('09:01:00'))).toBe(true);
  });

  it('never writes when idle sign-out is off', () => {
    const off = sessionPolicy({ idleMinutes: 0, maxHours: 12 });
    expect(needsTouch(off, at('08:00:00'), at('11:00:00'))).toBe(false);
  });
});
