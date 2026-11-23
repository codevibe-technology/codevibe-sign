// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicRecordView } from '@/lib/public-record';
import { PublicRecord } from './public-record';

const ID = 'Zk3vQ9xLm2Tn8RbYc4Wd7HsA';

const view: PublicRecordView = {
  id: ID,
  envelopeId: 'env_01KAZ3M7',
  title: 'Supply agreement',
  status: 'completed',
  completedAt: '2026-11-23T11:34:03.000Z',
  sender: { name: 'Asha Rao', organization: 'Acme Pvt Ltd' },
  documents: [
    {
      name: 'agreement.pdf',
      pageCount: 2,
      sha256: 'a'.repeat(64),
      sealedSha256: 'b'.repeat(64),
      seal: 'verified',
      sealedAt: '2026-11-23T11:34:09.000Z',
    },
  ],
  signers: [
    {
      name: 'Ravi Menon',
      contact: 'r****@example.com',
      role: 'signer',
      status: 'signed',
      auth: 'email_otp',
      actedAt: '2026-11-23T11:34:03.000Z',
    },
  ],
  trail: [
    {
      seq: 1,
      action: 'envelope.sent',
      at: '2026-11-23T11:00:00.000Z',
      actor: 'Asha Rao',
      hash: '1',
    },
    {
      seq: 2,
      action: 'recipient.signed',
      at: '2026-11-23T11:34:03.000Z',
      actor: 'Ravi Menon',
      hash: '2',
    },
  ],
  chain: { valid: true, head: 'c'.repeat(64), headAtSealing: 'd'.repeat(64) },
};

describe('PublicRecord', () => {
  it('shows the seal status, the people, the fingerprints and the trail', () => {
    render(<PublicRecord view={view} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Supply agreement' })).toBeVisible();
    expect(screen.getByTestId('record-seal')).toHaveTextContent('Sealed and unchanged');
    expect(screen.getByText('Asha Rao, Acme Pvt Ltd')).toBeVisible();
    expect(screen.getByText('Signer · r****@example.com · Email code')).toBeVisible();
    expect(screen.getByText('a'.repeat(64))).toBeVisible();
    expect(screen.getByText('b'.repeat(64))).toBeVisible();
    expect(screen.getByText('Chain intact')).toBeVisible();
    expect(screen.getByText('d'.repeat(64))).toBeVisible();
    expect(screen.getByText('2 recorded steps')).toBeVisible();
    expect(screen.getByText('Sent for signature')).toBeVisible();
  });

  it('offers the certificate and the audit trail, never the document', () => {
    render(<PublicRecord view={view} />);
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(
      expect.arrayContaining([
        `/r/${ID}/certificate`,
        `/r/${ID}/audit-trail`,
        `/r/${ID}/audit-trail?format=json`,
        '/verify',
      ]),
    );
    expect(links.some((href) => /documents|sealed|\.pdf$|dashboard|docs/.test(href ?? ''))).toBe(
      false,
    );
    expect(screen.getByText(/The signed document is not offered here/)).toBeVisible();
  });

  it('says so when a seal check failed or is still to come', () => {
    const failed = { ...view, documents: [{ ...view.documents[0]!, seal: 'failed' as const }] };
    const { unmount } = render(<PublicRecord view={failed} />);
    expect(screen.getByTestId('record-seal')).toHaveTextContent('Seal check failed');
    expect(within(screen.getByRole('status')).getByText(/Ask the sender/)).toBeVisible();
    unmount();
    const pending = {
      ...view,
      documents: [
        { ...view.documents[0]!, seal: 'pending' as const, sealedSha256: null, sealedAt: null },
      ],
      chain: { valid: false, head: null, headAtSealing: null },
    };
    render(<PublicRecord view={pending} />);
    expect(screen.getByTestId('record-seal')).toHaveTextContent('Sealing in progress');
    expect(screen.getByText('Chain broken')).toBeVisible();
  });

  it('keeps PDF reader brands and caveats out of the page', () => {
    const { container } = render(<PublicRecord view={view} />);
    expect(container.textContent).not.toMatch(/adobe|acrobat|identity unknown|not trusted/i);
    expect(container.textContent).not.toMatch(/[–—]/);
  });
});
