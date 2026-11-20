import { describe, expect, it } from 'vitest';
import { decodeChange, encodeChange } from './events';

const change = {
  workspaceId: 'ws_3f9c0a',
  envelopeId: '0b8f3c1e-2a4d-4f6b-9c1e-1d2e3f4a5b6c',
  actions: ['recipient.signed', 'envelope.completed', 'recipient.signed'],
};

describe('live change payloads', () => {
  it('carry the workspace id, envelope id and action names only', () => {
    const payload = encodeChange(change)!;
    expect(JSON.parse(payload)).toEqual({
      w: change.workspaceId,
      e: change.envelopeId,
      a: ['recipient.signed', 'envelope.completed'],
    });
  });

  it('drop anything else a caller passes along', () => {
    const payload = encodeChange({
      ...change,
      email: 'asha@example.com',
      title: 'Offer letter',
    } as typeof change)!;
    expect(payload).not.toMatch(/asha|Offer/);
    expect(Object.keys(JSON.parse(payload))).toEqual(['w', 'e', 'a']);
  });

  it('refuse values that are not ids or action names', () => {
    expect(encodeChange({ ...change, workspaceId: 'asha@example.com' })).toBeNull();
    expect(encodeChange({ ...change, actions: ['Asha Rao signed'] })).toBeNull();
    expect(encodeChange({ ...change, envelopeId: 'x'.repeat(65) })).toBeNull();
  });

  it('round-trip and reject malformed payloads', () => {
    expect(decodeChange(encodeChange(change)!)).toEqual({
      ...change,
      actions: ['recipient.signed', 'envelope.completed'],
    });
    expect(decodeChange('not json')).toBeNull();
    expect(decodeChange(JSON.stringify({ w: 'ws_1', e: 'e1' }))).toBeNull();
    expect(decodeChange(JSON.stringify({ w: 'ws 1', e: 'e1', a: [] }))).toBeNull();
    expect(decodeChange(JSON.stringify({ w: 'ws_1', e: 'e1', a: [1] }))).toBeNull();
  });
});
