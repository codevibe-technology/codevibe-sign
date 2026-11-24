import { describe, expect, it } from 'vitest';
import { formatCountdown, signInAfter, signOutNotice } from './idle-sign-out';

describe('formatCountdown', () => {
  it('shows minutes and seconds, rounding up', () => {
    expect(formatCountdown(120_000)).toBe('2:00');
    expect(formatCountdown(119_001)).toBe('2:00');
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(8_200)).toBe('0:09');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('signInAfter', () => {
  it('names the reason and comes back to the same page', () => {
    expect(signInAfter('idle', '/dashboard/acme/envelopes?view=sent')).toBe(
      '/sign-in?reason=idle&next=%2Fdashboard%2Facme%2Fenvelopes%3Fview%3Dsent',
    );
    expect(signInAfter('chosen', '/dashboard/acme')).toBe('/sign-in?next=%2Fdashboard%2Facme');
  });

  it('never carries another site as the way back', () => {
    expect(signInAfter('ended', '//evil.example/x')).toBe('/sign-in?reason=ended');
  });
});

describe('signOutNotice', () => {
  it('explains an idle sign-out with the configured time', () => {
    expect(signOutNotice('idle', 30)).toBe(
      'You were signed out after 30 minutes without activity, to keep your account safe. Sign in to pick up where you left off.',
    );
    expect(signOutNotice(['idle'], 1)).toMatch(/after 1 minute without/);
  });

  it('explains a session the server ended, and says nothing otherwise', () => {
    expect(signOutNotice('ended', 30)).toMatch(/session ended/);
    expect(signOutNotice(undefined, 30)).toBeNull();
    expect(signOutNotice('anything', 30)).toBeNull();
  });
});
