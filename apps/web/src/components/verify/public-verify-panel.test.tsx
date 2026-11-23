// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PublicVerifyPanel, type PublicOutcome } from './public-verify-panel';

const pdf = () => new File(['%PDF-1.7'], 'offer-sealed.pdf', { type: 'application/pdf' });

const valid: PublicOutcome = {
  valid: true,
  summary:
    'Authentic. This is exactly the document sealed by Codevibe Sign on this site, unchanged since.',
  reason: null,
  signer: 'Codevibe Sign, Codevibe Technology',
  signedAt: '2026-11-20T10:06:00.000Z',
  sha256: 'b'.repeat(64),
  fileName: 'offer-sealed.pdf',
  evidence: {
    title: 'Offer letter',
    documentName: 'offer.pdf',
    sentAt: '2026-11-20T09:01:00.000Z',
    completedAt: '2026-11-20T10:05:00.000Z',
    recipients: [
      {
        name: 'Asha Rao',
        contact: 'a****@example.com',
        role: 'signer',
        status: 'signed',
        auth: 'email_otp',
        actedAt: '2026-11-20T10:05:00.000Z',
      },
    ],
    events: [
      { seq: 1, action: 'envelope.sent', at: '2026-11-20T09:01:00.000Z', recipient: null },
      { seq: 2, action: 'recipient.signed', at: '2026-11-20T10:05:00.000Z', recipient: 'Asha Rao' },
    ],
    chain: { valid: true, head: 'c'.repeat(64), events: 2 },
  },
};

async function drop(
  result: Awaited<ReturnType<NonNullable<Parameters<typeof PublicVerifyPanel>[0]['check']>>>,
) {
  const check = vi.fn(async () => result);
  const user = userEvent.setup();
  const { container } = render(<PublicVerifyPanel check={check} />);
  await user.upload(container.querySelector('input[type=file]') as HTMLInputElement, pdf());
  return check;
}

describe('PublicVerifyPanel', () => {
  it('says the file is checked and not stored', () => {
    render(<PublicVerifyPanel check={vi.fn()} />);
    expect(screen.getByText(/not stored or logged/)).toBeInTheDocument();
  });

  it('shows the seal, the signers and an intact audit chain for a file this site sealed', async () => {
    const check = await drop({ ok: true, data: valid });
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ name: 'offer-sealed.pdf' }));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('Seal is valid')).toBeInTheDocument();
    expect(within(status).getByText('Offer letter')).toBeInTheDocument();
    expect(within(status).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(status).getByText(/a\*\*\*\*@example\.com/)).toBeInTheDocument();
    expect(within(status).getByText('Chain intact')).toBeInTheDocument();
    expect(within(status).getByText('2 recorded steps')).toBeInTheDocument();
    expect(within(status).getAllByText('Signed')).toHaveLength(2);
  });

  it('names the eSign provider of a signer who used Aadhaar eSign', async () => {
    const recipient = { ...valid.evidence!.recipients[0]!, auth: 'aadhaar' as const };
    await drop({
      ok: true,
      data: {
        ...valid,
        evidence: {
          ...valid.evidence!,
          recipients: [{ ...recipient, esign: { provider: 'leegality' } }],
        },
      },
    });
    const status = await screen.findByRole('status');
    expect(within(status).getByText(/Aadhaar eSign \(via Leegality\)/)).toBeInTheDocument();
  });

  it('warns when the seal is valid but this site has no record of the envelope', async () => {
    await drop({ ok: true, data: { ...valid, evidence: null } });
    expect(await screen.findByText('Seal is valid, no record here')).toBeInTheDocument();
    expect(screen.queryByText('Chain intact')).toBeNull();
  });

  it('explains why a changed file fails', async () => {
    await drop({
      ok: true,
      data: {
        ...valid,
        valid: false,
        reason: 'signature_invalid',
        summary: 'The seal is broken: the file was changed after it was sealed.',
        evidence: null,
      },
    });
    expect(await screen.findByText('Not verified')).toBeInTheDocument();
    expect(screen.getByText(/file was changed after it was sealed/)).toBeInTheDocument();
  });

  it('shows the server message when the check fails', async () => {
    await drop({
      ok: false,
      error: 'Too many checks from here. Wait a few minutes and try again.',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many checks');
  });
});
