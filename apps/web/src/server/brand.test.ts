import { describe, expect, it } from 'vitest';
import {
  LOGO_MAX_BYTES,
  checkOverrides,
  cleanSenderName,
  normalizeDomain,
  setLogo,
  sniffImage,
  updateEmailSettings,
  updateSigningSettings,
} from './brand';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error('should not be called');
    },
  },
) as never;

describe('logo checks', () => {
  it('knows images by their bytes', () => {
    expect(sniffImage(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(sniffImage(webp)).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it('refuses empty, oversized and non-image files before storing anything', async () => {
    const cases: [Uint8Array, RegExp][] = [
      [new Uint8Array(), /Choose an image/],
      [new Uint8Array(LOGO_MAX_BYTES + 1).fill(0x89), /under 512 KB/],
      [new TextEncoder().encode('<svg/>'), /PNG, JPEG or WebP/],
    ];
    for (const [bytes, message] of cases) {
      await expect(setLogo(untouched, untouched, 'ws_1', bytes)).rejects.toMatchObject({
        field: 'logo',
        message: expect.stringMatching(message),
      });
    }
  });
});

describe('email settings checks', () => {
  it('keeps overrides that say something and drops blank ones', () => {
    expect(
      checkOverrides({
        invite: { subject: ' Sign {{document_title}}\r\nnow ', intro: '' },
        reminder: { subject: '', intro: '   ' },
        cancelled: { intro: 'Sorry, {{status}}.' },
      }),
    ).toEqual({
      invite: { subject: 'Sign {{document_title}} now' },
      cancelled: { intro: 'Sorry, {{status}}.' },
    });
  });

  it('points at the override that uses a variable the email does not have', () => {
    expect(() => checkOverrides({ completed: { intro: 'Link: {{action}}' } })).toThrow(
      expect.objectContaining({ field: 'overrides.completed.intro' }),
    );
    expect(() => checkOverrides({ invite: { subject: 'x'.repeat(151) } })).toThrow(
      expect.objectContaining({ field: 'overrides.invite.subject' }),
    );
  });

  it('cleans the sender name for a From header', () => {
    expect(cleanSenderName(' Acme "HR" <x@y>\r\n ')).toBe('Acme HR x@y');
    expect(cleanSenderName('   ')).toBeNull();
  });

  it('refuses a bad reply-to before saving', async () => {
    await expect(
      updateEmailSettings(untouched, 'ws_1', {
        senderName: 'Acme',
        replyTo: 'not an email',
        overrides: {},
      }),
    ).rejects.toMatchObject({ field: 'replyTo' });
  });
});

describe('signing settings checks', () => {
  it('takes a domain typed with a scheme or path', () => {
    expect(normalizeDomain('https://Sign.Acme.com/path?x')).toBe('sign.acme.com');
    expect(normalizeDomain('sign.acme.com.')).toBe('sign.acme.com');
    expect(normalizeDomain('  ')).toBeNull();
    for (const bad of ['localhost', 'acme', 'sign_acme.com', '-x.acme.com', '1.2.3.4']) {
      expect(() => normalizeDomain(bad), bad).toThrow(
        expect.objectContaining({ field: 'signingDomain' }),
      );
    }
  });

  it("refuses the app's own host and an overlong footer", async () => {
    await expect(
      updateSigningSettings(
        untouched,
        'ws_1',
        { showBadge: true, certificateFooter: '', signingDomain: 'app.example.com' },
        'app.example.com',
      ),
    ).rejects.toMatchObject({ field: 'signingDomain' });
    await expect(
      updateSigningSettings(
        untouched,
        'ws_1',
        { showBadge: true, certificateFooter: 'x'.repeat(401), signingDomain: '' },
        'app.example.com',
      ),
    ).rejects.toMatchObject({ field: 'certificateFooter' });
  });
});
