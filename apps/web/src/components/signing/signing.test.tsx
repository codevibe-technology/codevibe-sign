// @vitest-environment jsdom
import type { Field, FieldValue } from '@codevibe_technology/sign-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { END_STATES, type SignerView, type SigningReceipt } from '@/lib/signing';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('@codevibe_technology/sign-react/styles.css', () => ({}));
vi.mock('@codevibe_technology/sign-react', () => ({
  SigningView: function SigningViewStub({
    documents,
    fields,
    onSubmit,
    onDecline,
    labels,
  }: {
    documents: { id: string; file: string }[];
    fields: Field[];
    onSubmit: (values: FieldValue[]) => Promise<void>;
    onDecline: (reason: string) => Promise<void>;
    labels: { finish: string };
  }) {
    const [message, setMessage] = useState('');
    const run = (work: () => Promise<void>) => work().catch((e: Error) => setMessage(e.message));
    return (
      <div data-testid="signing-view" data-files={documents.map((d) => d.file).join(',')}>
        <p>{`0 of ${fields.length} required fields done`}</p>
        <button type="button">Next field</button>
        <button
          type="button"
          onClick={() => run(() => onSubmit(fields.map((f) => ({ fieldId: f.id, value: 'PNG' }))))}
        >
          {labels.finish}
        </button>
        <button type="button" onClick={() => run(() => onDecline('Wrong salary'))}>
          Decline
        </button>
        <p role="status">{message}</p>
      </div>
    );
  },
}));

const { SigningApp } = await import('./signing-app');
const { EndStateMessage } = await import('./end-state');
const { SigningShell } = await import('./signing-shell');

const POLL = { sealing: 5, waiting: 5, giveUpAfter: 60_000 };

const view = (overrides: Partial<SignerView> = {}): SignerView => ({
  workspaceId: 'ws_0123456789abcdef0123',
  envelope: {
    id: 'env_1',
    title: 'Offer letter',
    message: 'Welcome aboard',
    status: 'sent',
    expiresAt: null,
  },
  recipient: {
    id: 'r1',
    name: 'Ravi Kumar',
    email: 'ravi@example.com',
    role: 'signer',
    status: 'notified',
    auth: 'email_link',
  },
  documents: [{ id: 'doc_1', name: 'offer.pdf', pageCount: 2 }],
  fields: [
    {
      id: 'f1',
      documentId: 'doc_1',
      recipientId: 'r1',
      type: 'signature',
      page: 0,
      rect: { x: 1, y: 1, width: 100, height: 30 },
      required: true,
    },
  ],
  values: [],
  otpRequired: false,
  authenticated: false,
  canAct: true,
  ...overrides,
});

const receipt = (overrides: Partial<SigningReceipt> = {}): SigningReceipt => ({
  workspaceId: 'ws_0123456789abcdef0123',
  envelope: { id: 'env_1', title: 'Offer letter', status: 'in_progress', completedAt: null },
  recipient: { id: 'r1', name: 'Ravi Kumar', role: 'signer', status: 'signed' },
  waitingFor: 1,
  documents: [{ id: 'doc_1', name: 'offer.pdf', sealed: false }],
  ...overrides,
});

const brand = {
  name: 'Acme HR',
  logoUrl: '/brand/ws_0123456789abcdef0123/logo?v=1',
  brandColor: '#0F766E',
  font: 'inter',
  showBadge: true,
};

type Reply = { status: number; body: unknown } | (() => { status: number; body: unknown });

/** A fake server: each `METHOD path` answers with the next queued reply, the last one repeating. */
function server(routes: Record<string, Reply | Reply[]>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const queues = new Map(
    Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? value : [value]]),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        method,
        path: input,
        ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}),
      });
      const queue = queues.get(`${method} ${input}`);
      if (!queue) return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      const { status, body } = typeof next === 'function' ? next() : next;
      return Response.json(body, { status });
    }),
  );
  return calls;
}

const ok = (body: unknown) => ({ status: 200, body });
const refused = (status: number, code: string, details: Record<string, unknown> = {}) => ({
  status,
  body: { error: { code, message: `${code} message`, details } },
});
const BRAND = 'GET /brand/ws_0123456789abcdef0123/signing';

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing page states', () => {
  it.each(END_STATES)('explains the %s state with a heading and what to do', (state) => {
    render(
      <SigningShell brand={null}>
        <EndStateMessage state={state} company="Acme HR" />
      </SigningShell>,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent?.length).toBeGreaterThan(10);
    expect(screen.getByRole('main').textContent?.length).toBeGreaterThan(60);
  });

  it('names the sender where it helps and stays generic without one', () => {
    const { rerender } = render(<EndStateMessage state="expired" company="Acme HR" />);
    expect(screen.getByText(/Ask Acme HR to send you a new one/)).toBeTruthy();
    rerender(<EndStateMessage state="voided" company={null} />);
    expect(screen.getByText(/The sender cancelled it/)).toBeTruthy();
  });

  it('draws the header in the brand and can hide the badge', () => {
    const { rerender } = render(
      <SigningShell brand={brand as never}>
        <p>Body</p>
      </SigningShell>,
    );
    const header = screen.getByRole('banner');
    expect(header.style.background).toBe('rgb(15, 118, 110)');
    expect(within(header).getByText('Acme HR')).toBeTruthy();
    expect(header.querySelector('img')?.getAttribute('src')).toBe(brand.logoUrl);
    expect(screen.getByTestId('signing-shell').style.getPropertyValue('--primary')).toBe('#0F766E');
    expect(screen.getByTestId('secured-badge')).toBeTruthy();
    rerender(
      <SigningShell brand={{ ...brand, showBadge: false } as never}>
        <p>Body</p>
      </SigningShell>,
    );
    expect(screen.queryByTestId('secured-badge')).toBeNull();
  });

  it('shows an invalid link when the cookie is gone and there is no receipt', async () => {
    server({
      'GET /api/v1/sign/link': refused(401, 'TOKEN_INVALID'),
      'GET /api/v1/sign/receipt': refused(401, 'TOKEN_INVALID'),
    });
    render(<SigningApp smsAvailable={false} />);
    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeTruthy();
  });

  it('says when it is not your turn yet, in the brand', async () => {
    server({ 'GET /api/v1/sign/link': ok(view({ canAct: false })), [BRAND]: ok(brand) });
    render(<SigningApp smsAvailable={false} />);
    expect(await screen.findByRole('heading', { name: 'It is not your turn yet' })).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText('Acme HR')).toBeTruthy();
  });

  it('offers a retry when the server cannot be reached', async () => {
    server({
      'GET /api/v1/sign/link': [{ status: 503, body: {} }, ok(view())],
      [BRAND]: ok(brand),
    });
    const user = userEvent.setup();
    render(<SigningApp smsAvailable={false} />);
    expect(await screen.findByText(/Something went wrong on our side/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Acme HR asks you to sign/)).toBeTruthy();
  });

  it('goes straight to the thank-you page when this browser already signed', async () => {
    server({
      'GET /api/v1/sign/link': refused(401, 'TOKEN_INVALID'),
      'GET /api/v1/sign/receipt': ok(receipt()),
      [BRAND]: ok(brand),
    });
    render(<SigningApp smsAvailable={false} poll={POLL} />);
    expect(await screen.findByRole('heading', { name: 'Thank you, Ravi' })).toBeTruthy();
    expect(await screen.findByText(/One more person needs to sign/)).toBeTruthy();
  });
});

describe('one-time code', () => {
  const otpView = view({
    otpRequired: true,
    recipient: { ...view().recipient, auth: 'email_otp' },
  });

  it('sends a code, explains a wrong one, then continues with the right one', async () => {
    const calls = server({
      'GET /api/v1/sign/link': [ok(otpView), ok({ ...otpView, authenticated: true })],
      [BRAND]: ok(brand),
      'POST /api/v1/sign/link/otp': ok({ sentTo: 'r***@example.com', expiresAt: 'x' }),
      'POST /api/v1/sign/link/otp/verify': [
        refused(401, 'OTP_INVALID', { attemptsLeft: 4 }),
        ok({ sessionToken: 's', expiresAt: 'x' }),
      ],
    });
    const user = userEvent.setup();
    render(<SigningApp smsAvailable={false} />);
    await user.click(await screen.findByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByText(/We sent a code to r\*\*\*@example.com/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-digit code');
    expect(calls.filter((c) => c.path.endsWith('/verify'))).toHaveLength(0);

    await user.type(screen.getByLabelText('6-digit code'), '111111');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not right. 4 tries left.',
    );

    await user.clear(screen.getByLabelText('6-digit code'));
    await user.type(screen.getByLabelText('6-digit code'), '482 913');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Acme HR asks you to sign/)).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith('/verify') && c.body)?.body).toEqual({
      code: '111111',
    });
    expect(calls.filter((c) => c.path.endsWith('/verify')).at(-1)?.body).toEqual({
      code: '482913',
    });
  });

  it('says plainly when no more codes can be sent', async () => {
    server({
      'GET /api/v1/sign/link': ok(otpView),
      [BRAND]: ok(brand),
      'POST /api/v1/sign/link/otp': refused(423, 'OTP_LOCKED', { reason: 'too_many_codes' }),
    });
    const user = userEvent.setup();
    render(<SigningApp smsAvailable={false} />);
    await user.click(await screen.findByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No more codes can be sent');
  });

  it('tells SMS recipients that text messages are not available on this install', async () => {
    const calls = server({
      'GET /api/v1/sign/link': ok({
        ...otpView,
        recipient: { ...otpView.recipient, auth: 'sms_otp' },
      }),
      [BRAND]: ok(brand),
    });
    render(<SigningApp smsAvailable={false} />);
    expect(
      await screen.findByRole('heading', { name: 'Text message codes are not available' }),
    ).toBeTruthy();
    expect(screen.getByText(/Ask Acme HR to send it to your email address/)).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith('/otp'))).toBe(false);
  });

  it('sends SMS codes when the install can', async () => {
    server({
      'GET /api/v1/sign/link': ok({
        ...otpView,
        recipient: { ...otpView.recipient, auth: 'sms_otp' },
      }),
      [BRAND]: ok(brand),
    });
    render(<SigningApp smsAvailable />);
    expect(await screen.findByText(/6-digit code by text message/)).toBeTruthy();
  });
});

describe('consent and signing', () => {
  it('shows what changed in a revised envelope above the document', async () => {
    server({
      'GET /api/v1/sign/link': ok(
        view({ envelope: { ...view().envelope, changeNote: 'Clause 4 now says 30 days.' } }),
      ),
      [BRAND]: ok(brand),
    });
    render(<SigningApp smsAvailable={false} />);
    expect(await screen.findByTestId('change-note')).toHaveTextContent(
      'What changed: Clause 4 now says 30 days.',
    );
  });

  it('needs the consent box ticked before the document opens', async () => {
    const calls = server({
      'GET /api/v1/sign/link': ok(view()),
      [BRAND]: ok(brand),
      'POST /api/v1/sign/link/view': ok({ envelopeStatus: 'sent', recipientStatus: 'viewed' }),
    });
    const user = userEvent.setup();
    render(<SigningApp smsAvailable={false} />);
    expect(await screen.findByText('Welcome aboard')).toBeTruthy();
    expect(screen.getByText(/offer\.pdf/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue to the document' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Tick the box');
    expect(screen.queryByTestId('signing-view')).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/view'))).toBe(false);

    await user.click(screen.getByRole('checkbox', { name: /legally binding/ }));
    await user.click(screen.getByRole('button', { name: 'Continue to the document' }));
    const signing = await screen.findByTestId('signing-view');
    expect(signing.dataset.files).toBe('/api/v1/sign/link/documents/doc_1');
    expect(screen.getByText('0 of 1 required fields done')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next field' })).toBeTruthy();
    expect(calls.filter((c) => c.path.endsWith('/view'))).toHaveLength(1);
  });

  async function openDocument(routes: Record<string, Reply | Reply[]>, roleView = view()) {
    const calls = server({
      'GET /api/v1/sign/link': ok(roleView),
      [BRAND]: ok(brand),
      'POST /api/v1/sign/link/view': ok({ envelopeStatus: 'sent', recipientStatus: 'viewed' }),
      ...routes,
    });
    const user = userEvent.setup();
    render(<SigningApp smsAvailable={false} poll={POLL} />);
    await user.click(await screen.findByRole('checkbox', { name: /legally binding/ }));
    await user.click(screen.getByRole('button', { name: 'Continue to the document' }));
    await screen.findByTestId('signing-view');
    return { calls, user };
  }

  it('submits with consent, thanks the signer and offers the copy once sealed', async () => {
    let sealed = false;
    const { calls, user } = await openDocument({
      'POST /api/v1/sign/link/submit': ok({
        envelopeStatus: 'completed',
        recipientStatus: 'signed',
      }),
      'GET /api/v1/sign/receipt': () =>
        ok(
          receipt({
            envelope: { id: 'env_1', title: 'Offer letter', status: 'completed', completedAt: 'x' },
            waitingFor: 0,
            documents: [{ id: 'doc_1', name: 'offer.pdf', sealed }],
          }),
        ),
    });
    await user.click(screen.getByRole('button', { name: 'Finish and sign' }));
    expect(await screen.findByRole('heading', { name: 'Thank you, Ravi' })).toBeTruthy();
    expect(await screen.findByText(/We are sealing your copy/)).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith('/submit'))?.body).toEqual({
      consent: true,
      values: [{ fieldId: 'f1', value: 'PNG' }],
    });
    sealed = true;
    const link = await screen.findByRole('link', { name: 'Download your copy' });
    expect(link.getAttribute('href')).toBe('/api/v1/sign/receipt/documents/doc_1');
    const polls = calls.filter((c) => c.path === '/api/v1/sign/receipt').length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.filter((c) => c.path === '/api/v1/sign/receipt')).toHaveLength(polls);
  });

  it('shows a refused submission next to the Finish button', async () => {
    const { user } = await openDocument({
      'POST /api/v1/sign/link/submit': refused(422, 'REQUIRED_FIELDS_MISSING'),
    });
    await user.click(screen.getByRole('button', { name: 'Finish and sign' }));
    expect(await screen.findByText('REQUIRED_FIELDS_MISSING message')).toBeTruthy();
    expect(screen.getByTestId('signing-view')).toBeTruthy();
  });

  it('labels the button Approve for approvers', async () => {
    await openDocument(
      {},
      view({ recipient: { ...view().recipient, role: 'approver' }, fields: [] }),
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByText(/approve it or decline/)).toBeTruthy();
  });

  it('declines with the reason and confirms it to the signer', async () => {
    const { calls, user } = await openDocument({
      'POST /api/v1/sign/link/decline': ok({
        envelopeStatus: 'declined',
        recipientStatus: 'declined',
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('heading', { name: 'You declined to sign' })).toBeTruthy();
    expect(screen.getByText(/We have let Acme HR know/)).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith('/decline'))?.body).toEqual({
      reason: 'Wrong salary',
    });
  });

  it('tells the signer when the request stops after they signed', async () => {
    const { user } = await openDocument({
      'POST /api/v1/sign/link/submit': ok({
        envelopeStatus: 'in_progress',
        recipientStatus: 'signed',
      }),
      'GET /api/v1/sign/receipt': [
        ok(receipt()),
        ok(
          receipt({
            envelope: { id: 'env_1', title: 'Offer letter', status: 'voided', completedAt: null },
          }),
        ),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Finish and sign' }));
    await waitFor(() =>
      expect(screen.getByText(/was voided, so it will not be completed/)).toBeTruthy(),
    );
  });
});
