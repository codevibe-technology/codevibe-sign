import { describe, expect, it } from 'vitest';
import {
  MAIL_KINDS,
  fillVariables,
  renderMail,
  sampleInput,
  unknownVariables,
  type MailBrand,
} from './mail-templates';

const brand: MailBrand = {
  company: 'Acme HR',
  brandColor: '#0F766E',
  logoUrl: null,
  showBadge: true,
  appUrl: 'https://sign.example.com',
};

describe('mail variables', () => {
  it('fills known variables once and leaves unknown ones visible', () => {
    expect(
      fillVariables('Hi {{ recipient_name }}, {{document_title}} {{nope}}', {
        recipient_name: 'Ravi',
        document_title: '{{recipient_name}}',
      }),
    ).toBe('Hi Ravi, {{recipient_name}} {{nope}}');
  });

  it('lists variables an email does not offer', () => {
    expect(unknownVariables('invite', '{{action}} {{status}} {{foo}}')).toEqual(['status', 'foo']);
    expect(unknownVariables('cancelled', '{{status}} {{company}}')).toEqual([]);
  });
});

describe('renderMail', () => {
  it('uses the defaults when nothing is overridden', () => {
    const mail = renderMail('invite', sampleInput('invite'), brand);
    expect(mail.subject).toBe('Acme HR asked you to sign "Offer letter"');
    expect(mail.text).toContain('Acme HR has asked you to sign "Offer letter".');
    expect(mail.text).toContain('Please sign by Friday');
    expect(mail.text).toContain('Expires: 31 Dec 2026, 00:00 UTC');
    expect(mail.text).toContain('Review and sign: https://sign.example.com/api/sign/');
    expect(mail.html).toContain('background:#0F766E');
    expect(mail.text).toContain('Sent with Codevibe Sign');
  });

  it('applies the subject and intro overrides with variables', () => {
    const mail = renderMail('reminder', { ...sampleInput('reminder'), role: 'approver' }, brand, {
      subject: '{{company}}: {{document_title}} needs you',
      intro: 'Hi again.\n\nPlease {{action}} before {{expires_on}}.',
    });
    expect(mail.subject).toBe('Acme HR: Offer letter needs you');
    expect(mail.text).toContain('Please approve before 31 Dec 2026, 00:00 UTC.');
    expect(mail.text).toContain('Review and approve:');
    expect(mail.html).toMatch(/<p [^>]*>Hi again\.<\/p>/);
  });

  it('writes the expiry in the workspace time zone and names the zone', () => {
    const input = { ...sampleInput('invite'), expiresAt: '2026-12-31T18:29:00.000Z' };
    const expiry = (timeZone?: string) =>
      /Expires: (.+)/.exec(
        renderMail('invite', { ...input, ...(timeZone ? { timeZone } : {}) }, brand).text,
      )?.[1];
    expect(expiry()).toBe('31 Dec 2026, 18:29 UTC');
    expect(expiry('Asia/Kolkata')).toBe('31 Dec 2026, 23:59 GMT+5:30');
    expect(expiry('America/New_York')).toBe('31 Dec 2026, 13:29 GMT-5');
    expect(expiry('Pacific/Auckland')).toBe('1 Jan 2027, 07:29 GMT+13');
  });

  it('falls back to the default for blank overrides', () => {
    const mail = renderMail('completed', sampleInput('completed'), brand, {
      subject: '  ',
      intro: '',
    });
    expect(mail.subject).toBe('Completed: "Offer letter"');
    expect(mail.text).toContain('The signed copy is attached.');
  });

  it('escapes everything that reaches the HTML', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const mail = renderMail(
      'invite',
      {
        ...sampleInput('invite'),
        recipientName: hostile,
        title: '"><script>x</script>',
        message: hostile,
        link: 'https://x.test/"onmouseover="alert(1)',
      },
      { ...brand, company: '<b>Acme</b>', logoUrl: 'https://x.test/logo"onerror="alert(1)' },
      { intro: '<a href="javascript:alert(1)">{{company}}</a>' },
    );
    expect(mail.html).not.toMatch(/<script|<img src=x|<b>Acme|<a href="javascript/);
    expect(mail.html).not.toContain('"onmouseover=');
    expect(mail.html).not.toContain('"onerror=');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;');
  });

  it('keeps line breaks out of the subject and a bad colour out of the styles', () => {
    const mail = renderMail(
      'invite',
      sampleInput('invite'),
      { ...brand, brandColor: 'red;background:url(x)' },
      { subject: 'Line one\r\nBcc: someone@evil.test' },
    );
    expect(mail.subject).toBe('Line one Bcc: someone@evil.test');
    expect(mail.html).not.toContain('url(x)');
  });

  it('tells cancelled recipients why and hides the badge when it is off', () => {
    const mail = renderMail(
      'cancelled',
      { ...sampleInput('cancelled'), envelopeStatus: 'declined' },
      { ...brand, showBadge: false },
    );
    expect(mail.text).toContain('"Offer letter" was declined.');
    expect(mail.text).not.toContain('Codevibe Sign');
    expect(mail.text).not.toContain('Review and');
  });

  it('renders every kind with a logo when there is one', () => {
    for (const kind of MAIL_KINDS) {
      const mail = renderMail(kind, sampleInput(kind), {
        ...brand,
        logoUrl: 'https://sign.example.com/brand/ws_1/logo?v=1',
      });
      expect(mail.html).toContain('<img src="https://sign.example.com/brand/ws_1/logo?v=1"');
      expect(mail.subject.length).toBeGreaterThan(5);
    }
  });

  it('gives every kind a plain-text part', () => {
    for (const kind of MAIL_KINDS) {
      const mail = renderMail(kind, sampleInput(kind), brand);
      expect(mail.text.trim().length).toBeGreaterThan(40);
      expect(mail.text).not.toMatch(/<[a-z]/i);
    }
  });

  it('lists a download link per document when the copy is not attached', () => {
    const downloads = [
      { name: 'offer.pdf', url: 'https://sign.example.com/api/v1/sign/copy/d1?c=x' },
      { name: 'nda.pdf', url: 'https://sign.example.com/api/v1/sign/copy/d2?c=x' },
    ];
    const mail = renderMail(
      'completed',
      { ...sampleInput('completed'), attached: false, downloads },
      brand,
    );
    expect(mail.text).toContain('offer.pdf: https://sign.example.com/api/v1/sign/copy/d1?c=x');
    expect(mail.text).toContain('nda.pdf: https://sign.example.com/api/v1/sign/copy/d2?c=x');
    expect(mail.html).toContain('href="https://sign.example.com/api/v1/sign/copy/d2?c=x"');
    expect(mail.text).not.toContain('Ask Acme HR');
    const attached = renderMail('completed', { ...sampleInput('completed'), downloads }, brand);
    expect(attached.text).not.toContain('/copy/');
  });
});
