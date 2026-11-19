import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  isStatusFilter,
  peopleLine,
  progressOf,
  relativeTime,
  sortEnvelopes,
  statusesFor,
  type EnvelopeSummary,
} from './envelopes';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const row = (patch: Partial<EnvelopeSummary>): EnvelopeSummary => ({
  id: 'e',
  title: 'T',
  status: 'sent',
  createdAt: NOW.toISOString(),
  sentAt: null,
  completedAt: null,
  expiresAt: null,
  documents: [],
  recipients: [],
  ...patch,
});

describe('envelope helpers', () => {
  it('groups sent and in progress as waiting', () => {
    expect(statusesFor('waiting')).toEqual(['sent', 'in_progress']);
    expect(isStatusFilter('completed')).toBe(true);
    expect(isStatusFilter('sent')).toBe(false);
  });

  it('writes relative times people read at a glance', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('just now');
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5 min ago');
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe('3 h ago');
    expect(relativeTime(ago(30 * 3_600_000), NOW)).toBe('yesterday');
    expect(relativeTime(ago(-3 * 86_400_000), NOW)).toBe('in 3 days');
    expect(relativeTime('2026-03-12T12:00:00.000Z', NOW)).toBe('12 Mar');
    expect(relativeTime('2025-03-12T12:00:00.000Z', NOW)).toBe('12 Mar 2025');
  });

  it('summarises people and progress', () => {
    expect(peopleLine([])).toBe('No recipients');
    expect(peopleLine(['Asha', 'Ravi'])).toBe('Asha and Ravi');
    expect(peopleLine(['Asha', 'Ravi', 'Mia', 'Zoe'])).toBe('Asha, Ravi and 2 more');
    const recipients = [
      { id: '1', name: 'A', email: null, role: 'signer', status: 'signed', actedAt: null },
      { id: '2', name: 'B', email: null, role: 'approver', status: 'viewed', actedAt: null },
      { id: '3', name: 'C', email: null, role: 'viewer', status: 'pending', actedAt: null },
    ] satisfies EnvelopeSummary['recipients'];
    expect(progressOf(recipients)).toEqual({ done: 1, total: 2 });
  });

  it('sorts loaded rows', () => {
    const rows = [
      row({ id: 'b', title: 'beta', status: 'completed', createdAt: ago(1000) }),
      row({ id: 'a', title: 'Alpha', status: 'draft', createdAt: ago(5000) }),
      row({ id: 'c', title: 'charlie', status: 'sent', createdAt: ago(0) }),
    ];
    const ids = (sort: Parameters<typeof sortEnvelopes>[1]) =>
      sortEnvelopes(rows, sort).map((r) => r.id);
    expect(ids('newest')).toEqual(['c', 'b', 'a']);
    expect(ids('oldest')).toEqual(['a', 'b', 'c']);
    expect(ids('title')).toEqual(['a', 'b', 'c']);
    expect(ids('status')).toEqual(['a', 'c', 'b']);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('labels audit actions, falling back to the raw name', () => {
    expect(actionLabel('recipient.signed')).toBe('Signed');
    expect(actionLabel('something.new')).toBe('something.new');
  });
});
