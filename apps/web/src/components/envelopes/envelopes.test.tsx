// @vitest-environment jsdom
import type { AuditEvent, Envelope } from '@codevibe_technology/sign-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvelopePage, EnvelopeSummary } from '@/lib/envelopes';

const mocks = vi.hoisted(() => ({
  voidEnvelopesAction: vi.fn(),
  remindAction: vi.fn(),
  verifyDocumentAction: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/server/actions/envelopes', () => ({
  voidEnvelopesAction: mocks.voidEnvelopesAction,
  remindAction: mocks.remindAction,
  verifyDocumentAction: mocks.verifyDocumentAction,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const { EnvelopesTable } = await import('./envelopes-table');
const { VerifyPanel } = await import('./verify-panel');
const { CertificateCard, RecipientsCard, SealBadge, Timeline } = await import('./envelope-detail');

const row = (patch: Partial<EnvelopeSummary>): EnvelopeSummary => ({
  id: 'env_1',
  title: 'Offer letter',
  status: 'sent',
  createdAt: '2026-11-19T10:00:00.000Z',
  sentAt: null,
  completedAt: null,
  expiresAt: null,
  documents: [{ id: 'doc_1', name: 'offer.pdf', pageCount: 1 }],
  recipients: [
    {
      id: 'r1',
      name: 'Ravi',
      email: 'ravi@example.com',
      role: 'signer',
      status: 'signed',
      actedAt: null,
    },
    {
      id: 'r2',
      name: 'Mia',
      email: 'mia@example.com',
      role: 'signer',
      status: 'notified',
      actedAt: null,
    },
  ],
  ...patch,
});

const PAGE: EnvelopePage = {
  envelopes: [
    row({}),
    row({
      id: 'env_2',
      title: 'Appraisal',
      status: 'completed',
      createdAt: '2026-11-18T10:00:00.000Z',
    }),
    row({
      id: 'env_3',
      title: 'Contract draft',
      status: 'draft',
      createdAt: '2026-11-17T10:00:00.000Z',
    }),
  ],
  nextCursor: 'c1',
};

let requests: string[] = [];
let pages: EnvelopePage[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  requests = [];
  pages = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push(`${url}|${new Headers(init.headers).get('x-workspace')}`);
      const page = pages.shift() ?? { envelopes: [], nextCursor: null };
      return new Response(JSON.stringify(page), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

function table(props: Partial<Parameters<typeof EnvelopesTable>[0]> = {}) {
  return render(
    <EnvelopesTable
      slug="acme"
      workspaceId="ws_1"
      initial={PAGE}
      initialStatus={null}
      initialQuery=""
      canWrite
      {...props}
    />,
  );
}

describe('EnvelopesTable', () => {
  it('shows each envelope with its status, people and progress', () => {
    table();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Offer letter');
    expect(rows[0]).toHaveTextContent('Ravi and Mia');
    expect(rows[0]).toHaveTextContent('Waiting for others');
    expect(rows[0]).toHaveTextContent('1 of 2');
    expect(within(rows[2]!).getByRole('link', { name: 'Contract draft' })).toHaveAttribute(
      'href',
      '/w/acme/envelopes/new?draft=env_3',
    );
  });

  it('filters by status and searches through the API', async () => {
    const user = userEvent.setup();
    table();
    pages.push({ envelopes: [row({ id: 'env_4', title: 'Found' })], nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Waiting for others' }));
    await screen.findByText('Found');
    expect(requests[0]).toBe('/api/v1/envelopes?limit=25&status=sent%2Cin_progress|ws_1');
    expect(window.location.search).toBe('?status=waiting');

    pages.push({ envelopes: [], nextCursor: null });
    await user.type(screen.getByRole('searchbox', { name: 'Search by title' }), 'zzz');
    expect(await screen.findByText('Nothing matches')).toBeTruthy();
    expect(requests.at(-1)).toContain('q=zzz');
    pages.push(PAGE);
    await user.click(screen.getByRole('button', { name: 'Show all envelopes' }));
    await screen.findByText('Appraisal');
  });

  it('loads the next page after the last row', async () => {
    const user = userEvent.setup();
    table();
    pages.push({ envelopes: [row({ id: 'env_9', title: 'Older one' })], nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Older one');
    expect(requests[0]).toContain('cursor=c1');
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('sorts the loaded rows', async () => {
    const user = userEvent.setup();
    table();
    await user.selectOptions(screen.getByLabelText('Sort'), 'title');
    const titles = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelector('a')?.textContent);
    expect(titles).toEqual(['Appraisal', 'Contract draft', 'Offer letter']);
  });

  it('voids the selected envelopes with a reason', async () => {
    const user = userEvent.setup();
    mocks.voidEnvelopesAction.mockResolvedValue({
      ok: true,
      data: { voided: ['env_1', 'env_3'], failed: [] },
    });
    table();
    expect(screen.queryByRole('checkbox', { name: 'Select Appraisal' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select all that can be voided' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Void selected' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Void 2' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Say why');
    expect(mocks.voidEnvelopesAction).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Wrong start date');
    await user.click(within(dialog).getByRole('button', { name: 'Void 2' }));
    expect(mocks.voidEnvelopesAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      envelopeIds: ['env_1', 'env_3'],
      reason: 'Wrong start date',
    });
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('2 envelopes voided'));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('says which envelopes could not be voided', async () => {
    const user = userEvent.setup();
    mocks.voidEnvelopesAction.mockResolvedValue({
      ok: true,
      data: {
        voided: ['env_1'],
        failed: [{ id: 'env_3', error: 'Only an admin can void an envelope someone else sent.' }],
      },
    });
    table();
    await user.click(screen.getByRole('button', { name: 'Actions for Offer letter' }));
    await user.click(await screen.findByRole('menuitem', { name: /Void/ }));
    await user.type(screen.getByLabelText('Reason'), 'x');
    await user.click(screen.getByRole('button', { name: 'Void envelope' }));
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        expect.stringMatching(/1 could not be voided: Only an admin/),
      ),
    );
  });

  it('gives viewers a read-only list', async () => {
    const user = userEvent.setup();
    table({ canWrite: false });
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.getByRole('link', { name: 'Contract draft' })).toHaveAttribute(
      'href',
      '/w/acme/envelopes/env_3',
    );
    await user.click(screen.getByRole('button', { name: 'Actions for Offer letter' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText(/Void/)).toBeNull();
    expect(within(menu).queryByText(/Remind/)).toBeNull();
    expect(within(menu).getByText('Open details')).toBeTruthy();
  });

  it('offers the signed PDF and reminders from the row menu', async () => {
    const user = userEvent.setup();
    mocks.remindAction.mockResolvedValue({
      ok: false,
      code: 'CONFLICT',
      error: 'A link was sent less than 15 minutes ago. Try again later.',
    });
    table();
    await user.click(screen.getByRole('button', { name: 'Actions for Appraisal' }));
    expect(await screen.findByRole('menuitem', { name: 'Download signed PDF' })).toHaveAttribute(
      'href',
      '/w/acme/envelopes/env_2/documents/doc_1?version=sealed',
    );
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Actions for Offer letter' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remind signers' }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'A link was sent less than 15 minutes ago. Try again later.',
      ),
    );
  });

  it('starts with an empty state that leads to sending', () => {
    table({ initial: { envelopes: [], nextCursor: null } });
    expect(screen.getByText('No envelopes yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Send a document' })).toHaveAttribute(
      'href',
      '/w/acme/envelopes/new',
    );
  });
});

describe('VerifyPanel', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>) =>
    user.upload(
      screen.getByLabelText('Choose a file'),
      new File(['%PDF-'], 'signed.pdf', { type: 'application/pdf' }),
    );

  it('confirms an authentic document and links to its envelope', async () => {
    const user = userEvent.setup();
    mocks.verifyDocumentAction.mockResolvedValue({
      ok: true,
      data: {
        valid: true,
        summary:
          'Authentic. This is exactly the document sealed by this workspace, unchanged since.',
        signer: 'Acme seal',
        signedAt: '2026-11-19T10:00:00.000Z',
        sha256: 'ab'.repeat(32),
        fileName: 'signed.pdf',
        envelope: { envelopeId: 'env_1', title: 'Offer letter', documentName: 'offer.pdf' },
      },
    });
    render(<VerifyPanel workspaceId="ws_1" slug="acme" />);
    await pick(user);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Authentic');
    expect(status).toHaveTextContent('Acme seal');
    expect(within(status).getByRole('link', { name: /Offer letter/ })).toHaveAttribute(
      'href',
      '/w/acme/envelopes/env_1',
    );
    expect((mocks.verifyDocumentAction.mock.calls[0]![0] as FormData).get('workspaceId')).toBe(
      'ws_1',
    );
  });

  it('explains a failed check in plain words', async () => {
    const user = userEvent.setup();
    mocks.verifyDocumentAction.mockResolvedValue({
      ok: true,
      data: {
        valid: false,
        summary: 'The seal is broken: the file was changed after it was sealed.',
        signer: null,
        signedAt: null,
        sha256: 'cd'.repeat(32),
        fileName: 'signed.pdf',
        envelope: null,
      },
    });
    render(<VerifyPanel workspaceId="ws_1" slug="acme" />);
    await pick(user);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Not verified');
    expect(status).toHaveTextContent('the file was changed after it was sealed');
    expect(within(status).queryByRole('link')).toBeNull();
  });

  it('shows a refusal as an error', async () => {
    const user = userEvent.setup();
    mocks.verifyDocumentAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'That file is not a PDF.',
    });
    render(<VerifyPanel workspaceId="ws_1" slug="acme" />);
    await pick(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is not a PDF.');
  });
});

describe('envelope detail', () => {
  const envelope: Envelope = {
    id: 'env_1',
    title: 'Offer letter',
    status: 'in_progress',
    routing: 'sequential',
    documents: [
      { id: 'doc_1', name: 'offer.pdf', sha256: 'a'.repeat(64), pageCount: 1, fileKey: 'k' },
    ],
    recipients: [
      {
        id: 'r1',
        name: 'Ravi',
        email: 'ravi@example.com',
        role: 'signer',
        order: 1,
        auth: 'email_otp',
        status: 'signed',
        actedAt: '2026-11-19T10:00:00.000Z',
      },
      {
        id: 'r2',
        name: 'Mia',
        email: 'mia@example.com',
        role: 'approver',
        order: 2,
        auth: 'email_link',
        status: 'notified',
      },
    ],
    fields: [],
    values: [],
    reminders: { firstAfterDays: 2, everyDays: 2, max: 5 },
    createdAt: '2026-11-18T10:00:00.000Z',
  };

  it('lists recipients with their status and offers to resend to whoever is next', () => {
    render(<RecipientsCard workspaceId="ws_1" envelope={envelope} currentIds={['r2']} canRemind />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Signed');
    expect(items[0]).toHaveTextContent('Signer · Email code');
    expect(within(items[0]!).queryByRole('button')).toBeNull();
    expect(items[1]).toHaveTextContent('Invited');
    expect(within(items[1]!).getByRole('button', { name: 'Resend link' })).toBeTruthy();
  });

  it('hides resending from people who cannot send', () => {
    render(
      <RecipientsCard
        workspaceId="ws_1"
        envelope={envelope}
        currentIds={['r2']}
        canRemind={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resend link' })).toBeNull();
  });

  it('shows the timeline newest first with the chain badge', () => {
    const event = (
      seq: number,
      action: AuditEvent['action'],
      recipientId?: string,
    ): AuditEvent => ({
      seq,
      envelopeId: 'env_1',
      action,
      at: `2026-11-19T1${seq}:00:00.000Z`,
      ...(recipientId ? { recipientId } : {}),
      prevHash: '0',
      hash: '1',
    });
    const events = [
      event(1, 'envelope.created'),
      event(2, 'envelope.updated'),
      event(3, 'recipient.signed', 'r1'),
    ];
    const { rerender } = render(<Timeline events={events} chainValid envelope={envelope} />);
    expect(screen.getByText('Audit chain intact')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Ravi: Signed');
    rerender(<Timeline events={events} chainValid={false} envelope={envelope} />);
    expect(screen.getByText('Audit chain broken')).toBeTruthy();
  });

  it('renders the certificate and the seal state', () => {
    render(
      <CertificateCard
        downloadHref="/w/acme/envelopes/env_1/certificate"
        certificate={{
          envelopeId: 'env_1',
          title: 'Offer letter',
          status: 'completed',
          completedAt: '2026-11-19T10:00:00.000Z',
          auditHead: 'f'.repeat(64),
          chainValid: true,
          documents: [
            {
              id: 'doc_1',
              name: 'offer.pdf',
              sha256: 'a'.repeat(64),
              sealedSha256: 'b'.repeat(64),
            },
          ],
          recipients: [
            {
              id: 'r1',
              name: 'Ravi',
              email: 'ravi@example.com',
              phone: null,
              role: 'signer',
              auth: 'email_otp',
              status: 'signed',
              actions: [
                {
                  action: 'recipient.signed',
                  at: '2026-11-19T10:00:00.000Z',
                  ip: '203.0.113.9',
                  userAgent: null,
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('b'.repeat(64))).toBeTruthy();
    expect(screen.getByText(/203\.0\.113\.9/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'JSON' })).toHaveAttribute(
      'href',
      '/w/acme/envelopes/env_1/certificate',
    );
    const { rerender } = render(<SealBadge check={null} />);
    expect(screen.getByText('Sealing in progress')).toBeTruthy();
    rerender(
      <SealBadge
        check={{
          documentId: 'd',
          valid: false,
          reason: 'signature_invalid',
          signer: null,
          signedAt: null,
          certificateSha256: null,
          sha256: 'x',
        }}
      />,
    );
    expect(screen.getByText('Seal not valid')).toBeTruthy();
  });
});
