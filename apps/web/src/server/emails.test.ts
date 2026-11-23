import { mkdirSync, writeFileSync } from 'node:fs';
import type { Envelope, Mailer, Recipient } from '@codevibe_technology/sign-core';
import { describe, expect, it } from 'vitest';
import {
  codeMail,
  declineNotice,
  renderMail,
  sampleInput,
  type MailBrand,
} from '@/lib/mail-templates';
import type { Brand } from './brand';
import {
  installBookingEmail,
  invoiceEmail,
  operatorEmail,
  subscriptionEmail,
} from './billing/emails';
import type { BillingOrder } from './billing/orders';
import {
  sendInvitation,
  sendMagicLink,
  sendPasswordChanged,
  sendPasswordReset,
  sendTransferMail,
  type TransferMailKind,
} from './mail';
import { createOtpSender, createWorkspaceMail } from './sign/mail';

const APP = 'https://sign.example.com';
const LOGO = `<img src="${APP}/brand/logo-email.png" alt="Codevibe Sign" width="183" height="30"`;
const WORKSPACE_LOGO = `${APP}/brand/ws_1/logo?v=1`;

type Sent = Parameters<Mailer['send']>[0];
interface Mail {
  subject: string;
  html: string;
  text: string;
}
interface Case {
  name: string;
  mail: Mail;
  /** Where the button goes; null for the one email with nothing to click. */
  href: string | null;
  logo: 'codevibe' | 'workspace' | 'name';
}

function capture() {
  const sent: Sent[] = [];
  const mailer = { send: async (mail: Sent) => void sent.push(mail) } as unknown as Mailer;
  const last = (): Mail => {
    const mail = sent.at(-1)!;
    return { subject: mail.subject, html: mail.html ?? '', text: mail.text };
  };
  return { mailer, sent, last };
}

const brand: MailBrand = {
  company: 'Acme HR',
  brandColor: '#1B6AE0',
  logoUrl: null,
  showBadge: true,
  appUrl: APP,
  org: 'Codevibe Technology Private Limited, Gurugram, Haryana',
};

const seller = { name: 'Codevibe Technology Private Limited', address: 'Gurugram\nHaryana 122001' };
const order = {
  lines: [{ description: 'Aadhaar eSign credits × 10 @ ₹35' }],
  tax: { totalPaise: 41300 },
  seller,
  mode: 'live',
  razorpayPaymentId: 'pay_Q1',
} as unknown as BillingOrder;

/** Every email the app sends, with a sample of its data. */
async function allEmails(): Promise<Case[]> {
  const { mailer, last } = capture();
  const cases: Case[] = [];
  const add = (name: string, mail: Mail, href: string | null, logo: Case['logo'] = 'codevibe') =>
    cases.push({ name, mail, href, logo });

  const signIn = `${APP}/api/auth/magic-link/verify?token=abc`;
  await sendMagicLink(mailer, 'asha@acme.in', signIn);
  add('sign-in-link', last(), signIn);
  await sendInvitation(mailer, {
    to: 'ravi@acme.in',
    url: `${APP}/invite/tok`,
    workspaceId: 'ws_1',
    workspaceName: 'Acme HR',
    inviterName: 'Asha Rao',
    role: 'member',
  });
  add('team-invitation', last(), `${APP}/invite/tok`);
  await sendPasswordReset(mailer, 'asha@acme.in', `${APP}/reset-password?token=abc`, 30);
  add('password-reset', last(), `${APP}/reset-password?token=abc`);
  await sendPasswordChanged(mailer, 'asha@acme.in', `${APP}/sign-in`);
  add('password-changed', last(), `${APP}/sign-in`);
  const kinds: TransferMailKind[] = [
    'offered',
    'started',
    'accepted_owner',
    'accepted_recipient',
    'declined',
    'cancelled',
  ];
  for (const kind of kinds) {
    await sendTransferMail(mailer, kind, {
      to: 'ravi@acme.in',
      url: `${APP}/transfer/tok`,
      workspaceId: 'ws_1',
      workspaceName: 'Acme HR',
      ownerName: 'Asha Rao',
      recipient: 'ravi@acme.in',
      expiresOn: '1 Dec 2026',
      previousOwnerStays: true,
    });
    add(`transfer-${kind.replace('_', '-')}`, last(), `${APP}/transfer/tok`);
  }

  const link = sampleInput('invite').link!;
  add('signing-invite', renderMail('invite', sampleInput('invite'), brand), link);
  add(
    'signing-invite-aadhaar',
    renderMail('invite', { ...sampleInput('invite'), aadhaar: true }, brand),
    link,
  );
  add(
    'signing-invite-workspace-brand',
    renderMail('invite', sampleInput('invite'), {
      ...brand,
      brandColor: '#0F766E',
      logoUrl: WORKSPACE_LOGO,
      logoWide: true,
    }),
    link,
    'workspace',
  );
  add(
    'signing-invite-white-label',
    renderMail('invite', sampleInput('invite'), { ...brand, showBadge: false }),
    link,
    'name',
  );
  add('signing-reminder', renderMail('reminder', sampleInput('reminder'), brand), link);
  const copy = `${APP}/api/v1/sign/copy/d1?c=x`;
  add('signing-completed', renderMail('completed', sampleInput('completed'), brand), null);
  add(
    'signing-completed-download',
    renderMail(
      'completed',
      {
        ...sampleInput('completed'),
        attached: false,
        downloads: [{ name: 'Offer letter.pdf', url: copy }],
      },
      brand,
    ),
    copy,
  );
  add(
    'signing-cancelled',
    renderMail('cancelled', { ...sampleInput('cancelled'), envelopeStatus: 'declined' }, brand),
    null,
  );
  const envelopeUrl = `${APP}/dashboard/acme/envelopes/env_1`;
  add(
    'decline-notice',
    declineNotice({
      senderName: 'Asha Rao',
      title: 'Offer letter',
      declinedBy: 'Ravi Kumar',
      role: 'signer',
      reason: 'The joining date is wrong.',
      url: envelopeUrl,
      appUrl: APP,
    }),
    envelopeUrl,
  );
  add('signing-code', codeMail({ recipientName: 'Ravi Kumar', code: '482913' }, brand), null);

  add(
    'invoice',
    invoiceEmail({ number: 'CV-2026270042', issuedAt: new Date('2026-11-24'), order }, APP),
    `${APP}/dashboard`,
  );
  add(
    'cloud-term-reminder',
    subscriptionEmail(
      {
        subject: 'Your Codevibe Sign Cloud term ends on 1 Dec 2026',
        heading: 'Your Cloud term ends in 7 days',
        lines: ['The Cloud term of your account ends on 1 Dec 2026, in 7 days.'],
        details: [{ label: 'Term ends', value: '1 Dec 2026' }],
      },
      seller,
      APP,
    ),
    `${APP}/dashboard`,
  );
  add(
    'operator-notice',
    operatorEmail(
      {
        subject: 'A payment was received but not applied',
        advice: 'Refund the payment from the Razorpay dashboard, or apply it by hand.',
        test: false,
        paymentId: 'pay_1',
        details: [{ label: 'reason', value: 'term_changed' }],
      },
      APP,
    ),
    'https://dashboard.razorpay.com/app/payments/pay_1',
  );
  add(
    'install-help-booking',
    installBookingEmail(
      {
        id: 'bkg_1',
        orderId: 'ord_2',
        name: 'Asha Rao',
        email: 'asha@acme.in',
        phone: '+91 98765 43210',
        company: 'Acme Pvt Ltd',
        provider: 'Hostinger VPS',
        serverDetails: 'Ubuntu 24.04\n4 GB RAM',
        preferredTime: 'Weekday evenings',
        totalPaise: 590000,
        test: false,
      },
      APP,
    ),
    'mailto:asha@acme.in',
  );
  return cases;
}

const escaped = (value: string) => value.replace(/&/g, '&amp;');

describe('every email', async () => {
  const cases = await allEmails();

  it.each(cases.map((c) => [c.name, c] as const))('%s has the layout, logo and parts', (_, c) => {
    const { html, text, subject } = c.mail;
    expect(subject.trim()).not.toBe('');
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).not.toMatch(/\b[A-Z]{4,}\b/);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('max-width:600px');
    expect(html).not.toMatch(/display:\s*(flex|grid)|<svg/i);
    if (c.logo === 'codevibe') {
      expect(html).toContain(LOGO);
      expect(html).toContain(`${APP}/brand/logo-email-dark.png`);
    } else if (c.logo === 'workspace') {
      expect(html).toContain(`<img src="${escaped(WORKSPACE_LOGO)}" alt="Acme HR"`);
      expect(html).toContain('Sent with Codevibe Sign');
    } else {
      expect(html).not.toContain('logo-email');
      expect(html).not.toContain('Codevibe Sign');
    }
    if (c.href) {
      expect(html).toMatch(
        new RegExp(`<a href="${escaped(c.href).replace(/[?.]/g, '\\$&')}"[^>]*>`),
      );
      expect(html).toContain('Paste this link into your browser');
      expect(text).toContain(c.href);
    }
    expect(html).toContain('You got this email because');
    expect(text).toContain('You got this email because');
    expect(text.length).toBeGreaterThan(80);
    expect(text).not.toMatch(/<[a-z/]/i);
  });

  it('writes a preview of each email when EMAIL_PREVIEW_DIR is set', () => {
    const dir = process.env.EMAIL_PREVIEW_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const [i, c] of cases.entries()) {
      const name = `${String(i + 1).padStart(2, '0')}-${c.name}`;
      writeFileSync(`${dir}/${name}.html`, c.mail.html);
      writeFileSync(`${dir}/${name}.txt`, `Subject: ${c.mail.subject}\n\n${c.mail.text}`);
    }
  });
});

const recipient = (auth: Recipient['auth']): Recipient => ({
  id: 'rcp_1',
  name: 'Ravi Kumar',
  email: 'ravi@acme.in',
  role: 'signer',
  order: 1,
  auth,
  status: 'notified',
});

const deps = (logo: string | null) => ({
  appUrl: APP,
  org: null,
  workspaceName: async () => 'Acme',
  brand: async () =>
    ({
      logoUrl: logo,
      brandColor: '#0F766E',
      senderName: 'Acme HR',
      replyTo: 'hr@acme.in',
      showBadge: true,
      emailOverrides: {},
    }) as unknown as Brand,
});

describe('workspace mail', () => {
  it('names Aadhaar eSign to recipients who sign with it', async () => {
    const mail = await createWorkspaceMail(deps(null))('ws_1');
    const envelope = { title: 'Offer letter' } as Envelope;
    const invite = mail!.templates!.invite!({
      envelope,
      recipient: recipient('aadhaar'),
      link: `${APP}/sign/x`,
    });
    expect(invite.html).toContain('You have a document to sign with Aadhaar eSign');
    expect(invite.text).toContain('Signing method: Aadhaar eSign');
    const plain = mail!.templates!.invite!({
      envelope,
      recipient: recipient('email_link'),
      link: `${APP}/sign/x`,
    });
    expect(plain.text).not.toContain('Aadhaar');
  });

  it('sends one-time codes in the workspace brand, from its sender name', async () => {
    const { mailer, sent } = capture();
    await createOtpSender(mailer, deps('/brand/ws_1/logo?v=1')).send(
      recipient('email_otp'),
      '123456',
      { workspaceId: 'ws_1', envelopeId: 'env_1' },
    );
    expect(sent[0]).toMatchObject({
      to: 'ravi@acme.in',
      fromName: 'Acme HR',
      replyTo: 'hr@acme.in',
      subject: 'Your signing code is 123456',
      meta: { kind: 'otp', recipientId: 'rcp_1', workspaceId: 'ws_1', envelopeId: 'env_1' },
    });
    expect(sent[0]!.html).toContain(`<img src="${escaped(WORKSPACE_LOGO)}"`);
    expect(sent[0]!.text).toContain('123456');
  });

  it('refuses a recipient with no email address', async () => {
    const { mailer } = capture();
    const noEmail: Recipient = { ...recipient('email_otp'), email: undefined } as Recipient;
    await expect(createOtpSender(mailer, deps(null)).send(noEmail, '1')).rejects.toThrow(
      'has no email address',
    );
  });
});
