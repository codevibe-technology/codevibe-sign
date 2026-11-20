import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_EVENTS,
  deliveryHint,
  deliveryStatus,
  eventsSummary,
  normalizeEvents,
  prettyPayload,
  webhookProblems,
} from './webhooks';

const ok = { url: 'https://hooks.example.com/sign', description: '', events: ['*'] };

describe('webhook endpoints', () => {
  it('accepts a public https URL with events', () => {
    expect(webhookProblems(ok)).toEqual({});
  });

  it('says what is wrong with the URL', () => {
    const url = (value: string, options = {}) =>
      webhookProblems({ ...ok, url: value }, options).url;
    expect(url('')).toMatch(/Enter the URL/);
    expect(url('hooks.example.com')).toMatch(/full URL/);
    expect(url('http://hooks.example.com')).toMatch(/https/);
    expect(url('http://localhost:4000/hook', { allowInsecure: true })).toBeUndefined();
    expect(url('ftp://hooks.example.com', { allowInsecure: true })).toMatch(/https/);
    expect(url('https://user:pw@hooks.example.com')).toMatch(/user name and password/);
    expect(url('https://hooks.example.com/#x')).toMatch(/# part/);
    expect(url(`https://hooks.example.com/${'a'.repeat(2000)}`)).toMatch(/under 2000/);
  });

  it('needs known events and a short description', () => {
    expect(webhookProblems({ ...ok, events: [] }).events).toMatch(/at least one/);
    expect(webhookProblems({ ...ok, events: ['envelope.exploded'] }).events).toMatch(/not known/);
    expect(webhookProblems({ ...ok, description: 'x'.repeat(201) }).description).toMatch(/200/);
  });

  it('stores all events as * and keeps a stable order', () => {
    expect(normalizeEvents(['envelope.voided', 'envelope.sent'])).toEqual([
      'envelope.sent',
      'envelope.voided',
    ]);
    expect(normalizeEvents(['envelope.sent', '*'])).toEqual(['*']);
    expect(normalizeEvents([...WEBHOOK_EVENTS])).toEqual(['*']);
  });

  it('summarises events for the list', () => {
    expect(eventsSummary(['*'])).toBe('All events');
    expect(eventsSummary(['envelope.sent'])).toBe('envelope.sent');
    expect(eventsSummary(['a', 'b', 'c', 'd'])).toBe('a, b and 2 more');
  });
});

describe('delivery log', () => {
  it('turns a report into a status', () => {
    expect(deliveryStatus({ outcome: 'delivered', retryAt: null })).toBe('delivered');
    expect(deliveryStatus({ outcome: 'failed', retryAt: new Date() })).toBe('retrying');
    expect(deliveryStatus({ outcome: 'failed', retryAt: null })).toBe('failed');
    expect(deliveryStatus({ outcome: 'skipped', retryAt: null })).toBe('skipped');
  });

  it('indents JSON payloads and leaves anything else alone', () => {
    expect(prettyPayload('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyPayload('not json')).toBe('not json');
  });

  it('says what to do about a failed delivery', () => {
    const hint = (responseStatus: number | null, error: string | null = null) =>
      deliveryHint({ status: 'failed', responseStatus, error });
    expect(deliveryHint({ status: 'delivered', responseStatus: 200, error: null })).toBeNull();
    expect(deliveryHint({ status: 'skipped', responseStatus: null, error: null })).toMatch(
      /turned off/,
    );
    expect(hint(401)).toMatch(/signature with the current secret/);
    expect(hint(404)).toMatch(/URL path/);
    expect(hint(502)).toMatch(/Check its logs/);
    expect(hint(301)).toMatch(/only 2xx/);
    expect(hint(null, 'The operation was aborted due to timeout')).toMatch(/10 seconds/);
    expect(hint(null, 'getaddrinfo ENOTFOUND hooks.example.com')).toMatch(/public address/);
    expect(hint(null, 'socket hang up')).toBe('socket hang up');
  });
});
