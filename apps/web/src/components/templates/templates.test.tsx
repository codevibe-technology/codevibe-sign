// @vitest-environment jsdom
import type { Field, Recipient } from '@codevibe_technology/sign-core';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkRowView, BulkSendView } from '@/lib/bulk-send';
import type { TemplateDefinition, TemplateSummary } from '@/lib/templates';

const mocks = vi.hoisted(() => ({
  actions: {
    stageTemplateDocumentAction: vi.fn(),
    createTemplateAction: vi.fn(),
    updateTemplateAction: vi.fn(),
    duplicateTemplateAction: vi.fn(),
    archiveTemplateAction: vi.fn(),
    sendTemplateAction: vi.fn(),
    startBulkSendAction: vi.fn(),
    bulkSendStatusAction: vi.fn(),
    cancelBulkSendAction: vi.fn(),
  },
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/server/actions/templates', () => mocks.actions);
vi.mock('@/server/actions/envelopes', () => ({ inspectDocumentAction: vi.fn() }));
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

const { TemplatesList } = await import('./templates-list');
const { TemplateEditor } = await import('./template-editor');
const { SendTemplateForm } = await import('./send-template-form');
const { BulkSendForm } = await import('./bulk-send-form');
const { BulkProgress, notSentCsv } = await import('./bulk-progress');

Blob.prototype.arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(this);
  });
};
Blob.prototype.text ??= function (this: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(this);
  });
};

const A4 = { width: 595, height: 842 };
const definition: TemplateDefinition = {
  title: '',
  message: 'Welcome aboard',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 2,
  roles: [
    { id: 'r_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
    { id: 'r_hr', name: 'HR', type: 'signer', auth: 'email_otp' },
  ],
  documents: [{ id: 'd1', name: 'offer.pdf', size: 10, sha256: 'a'.repeat(64), pages: [A4] }],
  fields: ['r_emp', 'r_hr'].map((recipientId, i) => ({
    id: `f${i}`,
    documentId: 'd1',
    recipientId,
    type: 'signature' as const,
    page: 0,
    rect: { x: 72, y: 600 - i * 100, width: 150, height: 40 },
    required: true,
  })),
};
const template = { id: 'tpl_1', name: 'Offer letter', definition };

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
});

describe('TemplatesList', () => {
  const summary: TemplateSummary = {
    id: 'tpl_1',
    name: 'Offer letter',
    description: 'Full-time hires',
    roles: [
      { name: 'Employee', type: 'signer' },
      { name: 'HR', type: 'signer' },
    ],
    documentCount: 1,
    pageCount: 3,
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    createdByName: 'Asha',
  };

  it('invites the first template, or says nothing is archived', () => {
    const { unmount } = render(
      <TemplatesList slug="acme" workspaceId="ws_1" templates={[]} archived={false} canWrite />,
    );
    expect(screen.getByRole('link', { name: 'Create a template' })).toHaveAttribute(
      'href',
      '/w/acme/templates/new',
    );
    unmount();
    render(<TemplatesList slug="acme" workspaceId="ws_1" templates={[]} archived canWrite />);
    expect(screen.getByText('Nothing archived')).toBeInTheDocument();
  });

  it('lists each template with its roles and the ways to send it', () => {
    render(
      <TemplatesList
        slug="acme"
        workspaceId="ws_1"
        templates={[summary]}
        archived={false}
        canWrite
      />,
    );
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Employee, HR')).toBeInTheDocument();
    expect(within(row).getByText(/1 document · 3 pages/)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Use/ })).toHaveAttribute(
      'href',
      '/w/acme/templates/tpl_1/send',
    );
    expect(within(row).getByRole('link', { name: /Bulk send/ })).toHaveAttribute(
      'href',
      '/w/acme/templates/tpl_1/bulk',
    );
  });

  it('shows viewers the list without actions', () => {
    render(
      <TemplatesList
        slug="acme"
        workspaceId="ws_1"
        templates={[summary]}
        archived={false}
        canWrite={false}
      />,
    );
    expect(screen.queryByRole('link', { name: /Use/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /More for/ })).toBeNull();
  });

  it('archives from the menu and refreshes', async () => {
    const user = userEvent.setup();
    mocks.actions.archiveTemplateAction.mockResolvedValue({ ok: true, data: undefined });
    render(
      <TemplatesList
        slug="acme"
        workspaceId="ws_1"
        templates={[summary]}
        archived={false}
        canWrite
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More for Offer letter' }));
    await user.click(await screen.findByRole('menuitem', { name: /Archive/ }));
    await waitFor(() =>
      expect(mocks.actions.archiveTemplateAction).toHaveBeenCalledWith({
        workspaceId: 'ws_1',
        templateId: 'tpl_1',
        archived: true,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith('"Offer letter" archived.');
    expect(mocks.refresh).toHaveBeenCalled();
  });
});

describe('TemplateEditor', () => {
  const pdf = () =>
    new File([new Uint8Array(64).fill(37)], 'offer.pdf', { type: 'application/pdf' });
  const next = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /Continue|Save template|Save changes/ }));

  it('builds a template step by step and saves it with the staged file', async () => {
    const user = userEvent.setup();
    mocks.actions.stageTemplateDocumentAction.mockResolvedValue({
      ok: true,
      data: { pages: [A4], stagedKey: 'staged/ws_1/abc.pdf' },
    });
    mocks.actions.createTemplateAction.mockResolvedValue({ ok: true, data: { id: 'tpl_9' } });
    render(<TemplateEditor slug="acme" workspaceId="ws_1" />);

    await next(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one PDF');
    await user.upload(screen.getByLabelText('Choose files'), pdf());
    expect(await screen.findByText('offer.pdf')).toBeInTheDocument();
    await next(user);

    const name = screen.getByLabelText('Role name');
    await user.clear(name);
    await next(user);
    expect(await screen.findByText(/Name the role/)).toBeInTheDocument();
    await user.type(name, 'Employee');
    await next(user);

    await next(user);
    expect(screen.getByText(/Place a signature field for Employee/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Place signature for Employee' }));
    await next(user);

    await next(user);
    expect(screen.getByText(/Name the template/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Offer letter');
    await next(user);

    await waitFor(() => expect(mocks.actions.createTemplateAction).toHaveBeenCalled());
    const input = mocks.actions.createTemplateAction.mock.calls[0]![0];
    expect(input.documents).toEqual([
      expect.objectContaining({ name: 'offer.pdf', stagedKey: 'staged/ws_1/abc.pdf', pages: [A4] }),
    ]);
    expect(input.definition).toMatchObject({ name: 'Offer letter', routing: 'sequential' });
    expect(input.definition.roles).toEqual([expect.objectContaining({ name: 'Employee' })]);
    expect(input.definition.fields).toHaveLength(1);
    expect(mocks.push).toHaveBeenCalledWith('/w/acme/templates');
  });

  it('edits a saved template from any step and shows server problems on their step', async () => {
    const user = userEvent.setup();
    mocks.actions.updateTemplateAction.mockResolvedValueOnce({
      ok: false,
      code: 'VALIDATION',
      error: 'Another role already has this name.',
      field: 'roles.r_hr.name',
    });
    const { editorStateFrom } = await import('@/lib/templates');
    render(
      <TemplateEditor
        slug="acme"
        workspaceId="ws_1"
        initial={editorStateFrom({ id: 'tpl_1', name: 'Offer', description: null }, definition)}
      />,
    );
    expect(screen.getByText(/keeps its documents/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.actions.updateTemplateAction).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws_1', templateId: 'tpl_1' }),
      ),
    );
    expect(await screen.findByText('Another role already has this name.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Role name')).toHaveLength(2);
  });

  it('drops the fields of a role that is removed', async () => {
    const user = userEvent.setup();
    mocks.actions.updateTemplateAction.mockResolvedValue({ ok: true, data: { id: 'tpl_1' } });
    const { editorStateFrom } = await import('@/lib/templates');
    render(
      <TemplateEditor
        slug="acme"
        workspaceId="ws_1"
        initial={editorStateFrom({ id: 'tpl_1', name: 'Offer', description: null }, definition)}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Roles/ }));
    await user.click(screen.getByRole('button', { name: 'Remove HR' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.actions.updateTemplateAction).toHaveBeenCalled());
    const saved = mocks.actions.updateTemplateAction.mock.calls[0]![0].definition;
    expect(saved.roles.map((r: { name: string }) => r.name)).toEqual(['Employee']);
    expect(saved.fields.map((f: Field) => f.recipientId)).toEqual(['r_emp']);
  });
});

describe('SendTemplateForm', () => {
  const me = { name: 'Asha Rao', email: 'asha@acme.test' };

  it('asks for every role and sends with the people given', async () => {
    const user = userEvent.setup();
    mocks.actions.sendTemplateAction.mockResolvedValue({ ok: true, data: { envelopeId: 'env_1' } });
    render(<SendTemplateForm slug="acme" workspaceId="ws_1" template={template} me={me} />);
    expect(screen.getByLabelText('Title')).toHaveValue('Offer letter');
    expect(screen.getByLabelText('Message (optional)')).toHaveValue('Welcome aboard');

    await user.click(screen.getByRole('button', { name: 'Send now' }));
    expect(screen.getByText("Enter the Employee's name.")).toBeInTheDocument();
    expect(mocks.actions.sendTemplateAction).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Employee name'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Employee email'), 'ravi@example.com');
    const hr = screen.getAllByRole('listitem')[1]!;
    await user.click(within(hr).getByRole('button', { name: 'Me' }));
    expect(screen.getByLabelText('HR email')).toHaveValue('asha@acme.test');
    expect(screen.queryByRole('button', { name: 'Me' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(mocks.actions.sendTemplateAction).toHaveBeenCalled());
    expect(mocks.actions.sendTemplateAction.mock.calls[0]![0]).toEqual({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      people: {
        r_emp: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '' },
        r_hr: { name: 'Asha Rao', email: 'asha@acme.test', phone: '' },
      },
      title: 'Offer letter',
      message: 'Welcome aboard',
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Sent. Ravi Kumar gets the signing link now.');
    expect(mocks.push).toHaveBeenCalledWith('/w/acme/envelopes/env_1');
  });

  it('puts a refusal from the server next to the right person', async () => {
    const user = userEvent.setup();
    mocks.actions.sendTemplateAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'recipients[1].email is not a valid address',
      field: 'people.r_hr.email',
    });
    render(<SendTemplateForm slug="acme" workspaceId="ws_1" template={template} me={me} />);
    await user.type(screen.getByLabelText('Employee name'), 'Ravi');
    await user.type(screen.getByLabelText('Employee email'), 'ravi@example.com');
    await user.type(screen.getByLabelText('HR name'), 'Meera');
    await user.type(screen.getByLabelText('HR email'), 'hr@example.com');
    await user.click(screen.getByRole('button', { name: 'Send now' }));
    const email = await screen.findByLabelText('HR email');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(
      screen.getAllByText('recipients[1].email is not a valid address').length,
    ).toBeGreaterThan(0);
  });
});

describe('BulkSendForm', () => {
  const csvFile = (text: string, name = 'joiners.csv', type = 'text/csv') =>
    new File([text], name, { type });

  it('previews the file, points at bad cells and sends after consent to skip', async () => {
    const user = userEvent.setup();
    mocks.actions.startBulkSendAction.mockResolvedValue({
      ok: true,
      data: { bulkId: 'bulk_1', count: 1 },
    });
    render(<BulkSendForm slug="acme" workspaceId="ws_1" template={template} />);
    expect(screen.getByText('Employee name')).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText('Choose a file'),
      csvFile('Employee name,Employee email\nRavi,ravi@example.com\nMia,not-an-email\n'),
    );
    expect(await screen.findByText('1 ready')).toBeInTheDocument();
    expect(screen.getByText('1 row has problems')).toBeInTheDocument();
    expect(screen.getByText(/Row 3, column "Employee email":/)).toBeInTheDocument();
    const badCell = screen.getByRole('cell', { name: 'not-an-email' });
    expect(badCell.className).toMatch(/text-danger/);

    const send = screen.getByRole('button', { name: 'Send 1 envelope' });
    expect(send).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Skip the 1 row/ }));
    expect(send).toBeEnabled();

    await user.click(send);
    expect(screen.getByText("Enter the HR's name.")).toBeInTheDocument();
    expect(mocks.actions.startBulkSendAction).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('HR name'), 'Meera');
    await user.type(screen.getByLabelText('HR email'), 'hr@example.com');
    await user.click(send);
    await waitFor(() => expect(mocks.actions.startBulkSendAction).toHaveBeenCalled());
    expect(mocks.actions.startBulkSendAction.mock.calls[0]![0]).toMatchObject({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      fixed: { r_hr: { name: 'Meera', email: 'hr@example.com', phone: '' } },
      skipProblems: true,
    });
    expect(mocks.push).toHaveBeenCalledWith('/w/acme/templates/bulk/bulk_1');
  });

  it('refuses files that are not CSV and blocks unknown columns', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<BulkSendForm slug="acme" workspaceId="ws_1" template={template} />);
    await user.upload(
      screen.getByLabelText('Choose a file'),
      csvFile('x', 'joiners.xlsx', 'application/vnd.ms-excel'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/not a CSV file/);

    await user.upload(
      screen.getByLabelText('Choose a file'),
      csvFile('Employee name,Employee email,Salary\nRavi,ravi@example.com,10\n'),
    );
    expect(await screen.findByText(/Fix the file, then upload it again/)).toBeInTheDocument();
    expect(screen.getByText(/Header, column "Salary":/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send 1 envelope/ })).toBeDisabled();
  });
});

describe('BulkProgress', () => {
  const bulk: BulkSendView = {
    id: 'bulk_1',
    templateId: 'tpl_1',
    templateName: 'Offer letter',
    createdByName: 'Asha',
    status: 'sending',
    total: 3,
    sent: 1,
    failed: 0,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  const row = (line: number, extra: Partial<BulkRowView> = {}): BulkRowView => ({
    line,
    people: { r_emp: { name: `P${line}`, email: `p${line}@example.com`, phone: '' } },
    status: 'pending',
    envelopeId: null,
    error: null,
    ...extra,
  });

  it('polls while sending, then lists what happened to each row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.actions.bulkSendStatusAction.mockResolvedValue({
      ok: true,
      data: {
        bulk: { ...bulk, status: 'done', sent: 2, failed: 1, finishedAt: new Date().toISOString() },
        rows: [
          row(2, { status: 'sent', envelopeId: 'env_2' }),
          row(3, { status: 'sent', envelopeId: 'env_3' }),
          row(4, { status: 'failed', error: 'Bad email' }),
        ],
      },
    });
    render(
      <BulkProgress
        slug="acme"
        workspaceId="ws_1"
        initial={bulk}
        initialRows={[row(2, { status: 'sent', envelopeId: 'env_2' }), row(3), row(4)]}
        roles={definition.roles}
        canWrite
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(mocks.actions.bulkSendStatusAction).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      bulkId: 'bulk_1',
    });
    expect(await screen.findByText('2 sent, 1 failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByText('Bad email')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Envelope/ })[0]).toHaveAttribute(
      'href',
      '/w/acme/envelopes/env_2',
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.actions.bulkSendStatusAction).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Not sent 1' }));
    expect(screen.getAllByText(/^Row /)).toHaveLength(1);
  });

  it('stops a running send after asking', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.actions.cancelBulkSendAction.mockResolvedValue({ ok: true, data: undefined });
    mocks.actions.bulkSendStatusAction.mockResolvedValue({
      ok: true,
      data: { bulk: { ...bulk, status: 'cancelled' }, rows: [] },
    });
    render(
      <BulkProgress
        slug="acme"
        workspaceId="ws_1"
        initial={bulk}
        initialRows={[]}
        roles={definition.roles}
        canWrite
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(mocks.actions.cancelBulkSendAction).toHaveBeenCalledWith({
        workspaceId: 'ws_1',
        bulkId: 'bulk_1',
      }),
    );
    expect(await screen.findByText('Stopped after 1 sent')).toBeInTheDocument();
  });

  it('writes the rows that were not sent as a CSV to fix', () => {
    const csv = notSentCsv(
      [row(2, { status: 'sent' }), row(3, { status: 'failed', error: 'Bad "email", twice' })],
      definition.roles,
    );
    expect(csv).toBe(
      'Employee name,Employee email,Employee phone,HR name,HR email,HR phone,Problem\n' +
        'P3,p3@example.com,,,,,"Bad ""email"", twice"\n',
    );
  });
});
