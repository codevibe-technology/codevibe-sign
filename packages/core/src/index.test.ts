import { describe, expect, it } from 'vitest';
import * as core from './index';
import { PNG, SHA, T0, at, counterIds } from './test/fixtures';

const clock = (iso: string) => ({ now: () => new Date(iso) });

describe('public api', () => {
  it('runs a whole signing flow and produces a verifiable audit chain', async () => {
    const ids = counterIds('x');
    const hasher = core.webCryptoHasher;
    const stored: core.AuditEvent[] = [];
    const commit = async (result: core.TransitionResult) => {
      const committed = await core.commitTransition(result, stored.length + 1, hasher);
      stored.push(...committed.events);
      return committed;
    };

    let { envelope } = await commit(
      core.createEnvelope({ title: 'NDA', expiresAt: at(30) }, { clock: clock(T0), ids }),
    );
    const doc = core.addDocument(
      envelope,
      {
        name: 'nda.pdf',
        sha256: SHA,
        pageCount: 1,
        fileKey: 'k',
        pageSizes: [{ width: 595, height: 842 }],
      },
      { ids },
    );
    const signer = core.addRecipient(
      doc.envelope,
      { name: 'Asha', email: 'asha@example.com', auth: 'email_otp' },
      { ids },
    );
    const viewer = core.addRecipient(
      signer.envelope,
      { name: 'HR', email: 'hr@example.com', role: 'viewer' },
      { ids },
    );
    envelope = core.addField(
      viewer.envelope,
      {
        documentId: doc.document.id,
        recipientId: signer.recipient.id,
        type: 'signature',
        page: 0,
        rect: { x: 50, y: 700, width: 200, height: 60 },
      },
      { ids },
    ).envelope;

    envelope = (await commit(core.send(envelope, { clock: clock(at(0.1)) }))).envelope;
    const otp = core.createOtp(core.cryptoRandom, clock(at(0.2)));
    expect(core.verifyOtp(otp.state, otp.code, clock(at(0.2))).ok).toBe(true);
    envelope = (
      await commit(
        core.markViewed(envelope, { recipientId: signer.recipient.id }, { clock: clock(at(0.2)) }),
      )
    ).envelope;
    envelope = (
      await commit(
        core.markAuthenticated(
          envelope,
          { recipientId: signer.recipient.id },
          { clock: clock(at(0.2)) },
        ),
      )
    ).envelope;
    const done = await commit(
      core.submit(
        envelope,
        {
          recipientId: signer.recipient.id,
          values: [{ fieldId: envelope.fields[0]!.id, value: PNG }],
          context: { ip: '10.0.0.9' },
        },
        { clock: clock(at(0.3)) },
      ),
    );
    expect(done.envelope.status).toBe('completed');
    expect(done.effects).toContainEqual({ kind: 'seal', envelopeId: envelope.id });
    const sealed = await commit(
      core.recordSeal(
        done.envelope,
        { documentId: doc.document.id, sha256: 'c'.repeat(64) },
        { clock: clock(at(0.4)) },
      ),
    );

    expect(stored.map((e) => e.action)).toEqual([
      'envelope.created',
      'envelope.sent',
      'recipient.notified',
      'recipient.viewed',
      'recipient.authenticated',
      'recipient.signed',
      'envelope.completed',
      'document.sealed',
    ]);
    expect(
      await core.verifyChain(stored, hasher, { expectedHead: sealed.envelope.auditHead! }),
    ).toEqual({
      valid: true,
      head: sealed.envelope.auditHead,
    });

    const tampered = stored.map((e) =>
      e.action === 'recipient.signed' ? { ...e, context: { ip: '6.6.6.6' } } : e,
    );
    expect(await core.verifyChain(tampered, hasher)).toMatchObject({
      valid: false,
      brokenAt: 5,
      reason: 'hash',
    });
  });

  it('exports SignError with stable codes', () => {
    const error = new core.SignError('NOT_YOUR_TURN', 'wait');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NOT_YOUR_TURN');
    expect(error.name).toBe('SignError');
  });
});
