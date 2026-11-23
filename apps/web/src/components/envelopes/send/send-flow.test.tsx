// @vitest-environment jsdom
import type { Field, Recipient } from '@codevibe_technology/sign-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendFlowState } from '@/lib/send-flow';

const mocks = vi.hoisted(() => ({
  inspectDocumentAction: vi.fn(),
  replaceDocumentAction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/server/actions/envelopes', () => ({
  inspectDocumentAction: mocks.inspectDocumentAction,
  replaceDocumentAction: mocks.replaceDocumentAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('@codevibe_technology/sign-react', () => ({
  FieldPlacer: ({
    recipients,
    fields,
    documents,
    onChange,
  }: {
    recipients: Recipient[];
    fields: Field[];
    documents: { id: string; file: unknown }[];
    onChange: (fields: Field[]) => void;
  }) => (
    <div data-testid="placer" data-files={documents.map((d) => typeof d.file).join(',')}>
      {recipients
        .filter((r) => r.role !== 'viewer')
        .map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() =>
              onChange([
                ...fields,
                {
                  id: `f${fields.length}`,
                  documentId: documents[0]!.id,
                  recipientId: r.id,
                  type: 'signature',
                  page: 0,
                  rect: { x: 10, y: 10, width: 150, height: 40 },
                  required: true,
                },
              ])
            }
          >
            Place signature for {r.name}
          </button>
        ))}
    </div>
  ),
}));

const { SendFlow } = await import('./send-flow');

// jsdom's Blob has no arrayBuffer(); browsers do.
Blob.prototype.arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(this);
  });
};

const ME = { name: 'Asha Rao', email: 'asha@acme.test' };
const pdfFile = (name = 'offer-letter.pdf', size = 2048) =>
  new File([new Uint8Array(size).fill(37)], name, { type: 'application/pdf' });

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}
let calls: Call[] = [];
let respond: (call: Call) => { status: number; body: unknown };

const created = {
  id: 'env_1',
  title: 'Offer letter',
  documents: [{ id: 'doc_1', name: 'offer-letter.pdf', pageCount: 2 }],
  recipients: [{ id: 'rcp_1', name: 'Ravi Kumar' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  respond = (call) =>
    call.url === '/api/v1/envelopes'
      ? { status: 201, body: created }
      : { status: 200, body: { ...created, recipients: [{ id: 'rcp_1' }] } };
  mocks.inspectDocumentAction.mockResolvedValue({
    ok: true,
    data: {
      pageCount: 2,
      pages: [
        { width: 595, height: 842 },
        { width: 595, height: 842 },
      ],
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : init.body instanceof FormData
            ? JSON.parse(String(init.body.get('envelope')))
            : undefined;
      const call = { url, method: init.method ?? 'GET', body, headers: new Headers(init.headers) };
      calls.push(call);
      const { status, body: out } = respond(call);
      return new Response(JSON.stringify(out), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  window.scrollTo = vi.fn();
});

async function upload(user: ReturnType<typeof userEvent.setup>, ...files: File[]) {
  await user.upload(screen.getByLabelText('Choose files'), files);
}

const next = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /Continue|Send/ }));

describe('step 1: documents', () => {
  it('asks for a PDF before moving on', async () => {
    const user = userEvent.setup();
    render(<SendFlow slug="acme" workspaceId="ws_1" me={ME} />);
    await next(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one PDF to send.');
  });

  it('refuses files that are not PDFs or too big without uploading them', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<SendFlow slug="acme" workspaceId="ws_1" me={ME} />);
    const big = pdfFile('big.pdf');
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 });
    await upload(user, new File(['x'], 'cv.docx', { type: 'application/msword' }), big);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cv.docx is not a PDF');
    expect(alert).toHaveTextContent('big.pdf is 25.0 MB; the limit is 20 MB');
    expect(mocks.inspectDocumentAction).not.toHaveBeenCalled();
  });

  it('shows the server check plainly, for example a password-protected file', async () => {
    const user = userEvent.setup();
    mocks.inspectDocumentAction.mockResolvedValueOnce({
      ok: false,
      code: 'VALIDATION',
      error:
        'locked.pdf is password protected. Remove the password (print it to a new PDF) and add it again.',
      field: 'file',
    });
    render(<SendFlow slug="acme" workspaceId="ws_1" me={ME} />);
    await upload(user, pdfFile('locked.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('locked.pdf is password protected');
    expect(screen.queryByRole('list', { name: 'Documents' })).toBeNull();
  });

  it('lists checked files with their pages and lets you remove them', async () => {
    const user = userEvent.setup();
    render(<SendFlow slug="acme" workspaceId="ws_1" me={ME} />);
    await upload(user, pdfFile());
    const list = await screen.findByRole('list', { name: 'Documents' });
    expect(within(list).getByText('offer-letter.pdf')).toBeTruthy();
    expect(within(list).getByText(/2 pages/)).toBeTruthy();
    const form = mocks.inspectDocumentAction.mock.calls[0]![0] as FormData;
    expect(form.get('workspaceId')).toBe('ws_1');
    await user.click(screen.getByRole('button', { name: 'Remove offer-letter.pdf' }));
    expect(screen.queryByText('offer-letter.pdf')).toBeNull();
  });

  it('reminds the sender, without blocking, when a file looks like one the IT Act leaves out', async () => {
    const user = userEvent.setup();
    render(<SendFlow slug="acme" workspaceId="ws_1" me={ME} />);
    await upload(user, pdfFile('General power of attorney.pdf'));
    const notice = await screen.findByRole('complementary', {
      name: 'Documents that cannot be signed electronically',
    });
    expect(notice).toHaveTextContent('Trust deeds');
    expect(notice).toHaveTextContent('This is not legal advice.');
    expect(notice).not.toHaveTextContent(/immovable/i);
    await user.click(within(notice).getByRole('button', { name: 'Dismiss this notice' }));
    expect(
      screen.queryByRole('complementary', {
        name: 'Documents that cannot be signed electronically',
      }),
    ).toBeNull();
    await next(user);
    expect(await screen.findByRole('list', { name: 'Recipients' })).toBeTruthy();
  });

  it('shows no notice for ordinary documents', async () => {
    const user = userEvent.setup();
    render(<SendFlow slug="acme" workspaceId="ws_1" me={ME} />);
    await upload(user, pdfFile());
    await screen.findByRole('list', { name: 'Documents' });
    expect(screen.queryByText(/may not let you sign electronically/)).toBeNull();
  });
});

async function toRecipients(user: ReturnType<typeof userEvent.setup>) {
  render(<SendFlow slug="acme" workspaceId="ws_1" me={ME} />);
  await upload(user, pdfFile());
  await screen.findByRole('list', { name: 'Documents' });
  await next(user);
  await screen.findByRole('list', { name: 'Recipients' });
}

describe('step 2: recipients', () => {
  it('points at every field that needs fixing', async () => {
    const user = userEvent.setup();
    await toRecipients(user);
    await next(user);
    expect(screen.getByText('Add the people who need to sign.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add recipient' }));
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter their name.')).toBeTruthy();
    expect(screen.getByText('This email address does not look right.')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('asks for a mobile number when the code goes by SMS', async () => {
    const user = userEvent.setup();
    await toRecipients(user);
    await user.click(screen.getByRole('button', { name: 'Add me' }));
    expect(screen.queryByLabelText('Mobile number')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Identity check'), 'sms_otp');
    await next(user);
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a mobile number for the SMS code.')).toBeTruthy();
  });

  it('reorders people and switches between in order and all at once', async () => {
    const user = userEvent.setup();
    await toRecipients(user);
    await user.click(screen.getByRole('button', { name: 'Add me' }));
    await user.click(screen.getByRole('button', { name: 'Add recipient' }));
    const names = screen.getAllByLabelText('Name');
    await user.type(names[1]!, 'Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Move Ravi Kumar up' }));
    const items = within(screen.getByRole('list', { name: 'Recipients' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/^1RKRavi Kumar/);
    expect(items[1]).toHaveTextContent(/^2ARAsha Rao/);
    await user.click(screen.getByLabelText(/Everyone at once/));
    expect(
      within(screen.getByRole('list', { name: 'Recipients' })).getAllByRole('listitem')[0],
    ).toHaveTextContent(/^RKRavi Kumar/);
  });
});

async function toFields(user: ReturnType<typeof userEvent.setup>) {
  await toRecipients(user);
  await user.click(screen.getByRole('button', { name: 'Add recipient' }));
  await user.type(screen.getByLabelText('Name'), 'Ravi Kumar');
  await user.type(screen.getByLabelText('Email'), 'ravi@example.com');
  await next(user);
  await screen.findByTestId('placer');
}

describe('creating the draft', () => {
  it('saves the draft with the files and recipients when leaving step 2', async () => {
    const user = userEvent.setup();
    await toFields(user);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: '/api/v1/envelopes', method: 'POST' });
    expect(calls[0]!.headers.get('x-workspace')).toBe('ws_1');
    expect(calls[0]!.body).toMatchObject({
      title: 'Offer letter',
      routing: 'sequential',
      recipients: [{ name: 'Ravi Kumar', email: 'ravi@example.com', role: 'signer', order: 1 }],
      documents: [{ name: 'offer-letter.pdf' }],
    });
    expect(screen.getByText('Draft saved')).toBeTruthy();
    expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringMatching(/Saved as a draft/));
  });

  it('puts a refusal from the server next to the field', async () => {
    const user = userEvent.setup();
    respond = () => ({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION',
          message: 'recipients[0].email is not a valid email address',
          details: { issues: [{ path: 'recipients[0].email', message: 'Use a real address' }] },
        },
      },
    });
    await toRecipients(user);
    await user.click(screen.getByRole('button', { name: 'Add recipient' }));
    await user.type(screen.getByLabelText('Name'), 'Ravi');
    await user.type(screen.getByLabelText('Email'), 'ravi@example.com');
    await next(user);
    expect(await screen.findByText('Use a real address')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('placer')).toBeNull();
  });
});

describe('step 3 and 4: fields, review and send', () => {
  it('needs a signature for each signer, then sends the saved draft', async () => {
    const user = userEvent.setup();
    await toFields(user);
    expect(screen.getByTestId('placer').dataset.files).toBe('object');
    await next(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Place a signature field for Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Place signature for Ravi Kumar' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await next(user);

    expect(screen.getByLabelText('Title')).toHaveValue('Offer letter');
    await user.clear(screen.getByLabelText('Title'));
    await next(user);
    expect(screen.getByText(/recipients see it in the email subject/)).toBeTruthy();
    await user.type(screen.getByLabelText('Title'), 'Offer for Ravi');
    await user.type(screen.getByLabelText('Message (optional)'), 'Please sign by Friday');
    await user.selectOptions(screen.getByLabelText('Expires after'), '14');
    await next(user);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard/acme/envelopes/env_1'));
    const patch = calls.filter((c) => c.method === 'PATCH').at(-1)!;
    expect(patch.url).toBe('/api/v1/envelopes/env_1');
    expect(patch.body).toMatchObject({
      title: 'Offer for Ravi',
      message: 'Please sign by Friday',
      expiresInDays: 14,
      recipients: [{ id: 'rcp_1', key: 'rcp_1' }],
      fields: [{ recipient: 'rcp_1', type: 'signature', document: 'doc_1' }],
    });
    expect(calls.at(-1)).toMatchObject({ url: '/api/v1/envelopes/env_1/send', method: 'POST' });
    expect(mocks.toast.success).toHaveBeenLastCalledWith(
      'Sent. Ravi Kumar gets the signing link now.',
    );
  });

  it('shows why sending failed and keeps the work', async () => {
    const user = userEvent.setup();
    await toFields(user);
    await user.click(screen.getByRole('button', { name: 'Place signature for Ravi Kumar' }));
    await next(user);
    respond = (call) =>
      call.url.endsWith('/send')
        ? {
            status: 410,
            body: { error: { code: 'ENVELOPE_EXPIRED', message: 'This envelope has expired' } },
          }
        : { status: 200, body: { ...created, recipients: [{ id: 'rcp_1' }] } };
    await next(user);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('This envelope has expired'),
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toHaveValue('Offer letter');
  });
});

describe('reopening a draft', () => {
  const draft: SendFlowState = {
    envelopeId: 'env_9',
    documents: [{ id: 'doc_9', name: 'nda.pdf', size: 0, pages: [{ width: 595, height: 842 }] }],
    recipients: [
      {
        id: 'rcp_9',
        saved: true,
        name: 'Mia',
        email: 'mia@example.com',
        phone: '',
        role: 'signer',
        auth: 'email_link',
      },
    ],
    routing: 'sequential',
    fields: [],
    settings: { title: 'NDA', message: '', expiresInDays: 30, remindEveryDays: 2 },
  };

  it('loads pages from the server and saves changes by itself', async () => {
    const user = userEvent.setup();
    render(
      <SendFlow slug="acme" workspaceId="ws_1" me={ME} initial={draft} initialStep="fields" />,
    );
    expect((await screen.findByTestId('placer')).dataset.files).toBe('string');
    expect(screen.getByText('Draft saved')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Place signature for Mia' }));
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    expect(calls[0]).toMatchObject({ url: '/api/v1/envelopes/env_9', method: 'PATCH' });
    expect((calls[0]!.body as { fields: unknown[] }).fields).toHaveLength(1);
  });

  it('keeps the documents fixed once saved', async () => {
    const user = userEvent.setup();
    render(
      <SendFlow slug="acme" workspaceId="ws_1" me={ME} initial={draft} initialStep="recipients" />,
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Replace a file with a new version/)).toBeTruthy();
    expect(screen.queryByLabelText('Choose files')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove nda.pdf/ })).toBeNull();
  });

  it('replaces a document and says which fields moved', async () => {
    const user = userEvent.setup();
    const field = {
      id: 'f1',
      documentId: 'doc_9',
      recipientId: 'rcp_9',
      type: 'signature' as const,
      page: 0,
      rect: { x: 10, y: 10, width: 150, height: 40 },
      required: true,
    };
    mocks.replaceDocumentAction.mockResolvedValue({
      ok: true,
      data: {
        envelope: {
          documents: [
            { id: 'doc_9', name: 'nda-v2.pdf', pageSizes: [{ width: 612, height: 792 }] },
          ],
          fields: [field],
        },
        movedFields: ['f1'],
      },
    });
    render(
      <SendFlow
        slug="acme"
        workspaceId="ws_1"
        me={ME}
        initial={{ ...draft, fields: [field] }}
        initialStep="documents"
      />,
    );
    await user.upload(screen.getByLabelText('Replace nda.pdf'), pdfFile('nda-v2.pdf'));
    expect(await screen.findByText(/1 field was moved because its page changed/)).toBeTruthy();
    expect(screen.getByText('nda-v2.pdf')).toBeTruthy();
    const form = mocks.replaceDocumentAction.mock.calls[0]![0] as FormData;
    expect(form.get('envelopeId')).toBe('env_9');
    expect(form.get('documentId')).toBe('doc_9');
  });

  it('shows why the envelope it revises was declined and asks what changed', async () => {
    const user = userEvent.setup();
    render(
      <SendFlow
        slug="acme"
        workspaceId="ws_1"
        me={ME}
        initial={{ ...draft, settings: { ...draft.settings, changeNote: '' } }}
        initialStep="review"
        revision={{
          title: 'NDA',
          declinedBy: 'Satyam Patel',
          role: 'approver',
          reason: 'Clause 4 is wrong',
        }}
      />,
    );
    const note = screen.getByRole('complementary', { name: 'Why it was declined' });
    expect(note).toHaveTextContent('Declined by Satyam Patel (approver)');
    expect(note).toHaveTextContent('Clause 4 is wrong');
    await user.type(
      screen.getByLabelText('Note to recipients about what changed (optional)'),
      'Clause 4 fixed',
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 3000 });
    expect((calls.at(-1)!.body as { changeNote: string }).changeNote).toBe('Clause 4 fixed');
  });
});
