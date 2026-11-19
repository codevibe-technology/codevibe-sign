import { describe, expect, it } from 'vitest';
import { PNG } from './test/fixtures';
import type { Field, Recipient } from './types';
import {
  checkFieldValue,
  isFilled,
  isIsoDate,
  isValidEmail,
  isValidPhone,
  MAX_IMAGE_BYTES,
  MAX_TEXT_LENGTH,
  normalizePng,
  pageSizeIssues,
  rectIssues,
  recipientIssues,
  reminderIssues,
} from './validation';

const page = { width: 612, height: 792 };

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last+tag@mail.example.in', "o'neil@example.com"])(
    'accepts %s',
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    },
  );

  it.each([
    '',
    'plain',
    'a@b',
    '@b.co',
    'a@.co',
    'a b@c.co',
    'a..b@c.co',
    '.a@c.co',
    'a@-b.co',
    `${'a'.repeat(250)}@b.co`,
  ])('rejects %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe('isValidPhone', () => {
  it('accepts E.164 numbers', () => {
    expect(isValidPhone('+919876543210')).toBe(true);
    expect(isValidPhone('+14155552671')).toBe(true);
  });

  it.each(['9876543210', '+0123456789', '+91 98765 43210', '+12', '+1234567890123456'])(
    'rejects %s',
    (phone) => {
      expect(isValidPhone(phone)).toBe(false);
    },
  );
});

describe('recipientIssues', () => {
  const base: Recipient = {
    id: 'r1',
    name: 'Asha',
    email: 'asha@example.com',
    role: 'signer',
    order: 1,
    auth: 'email_link',
    status: 'pending',
  };
  const paths = (r: Partial<Recipient>) =>
    recipientIssues({ ...base, ...r }, 'r').map((i) => i.path);

  it('accepts a well-formed recipient', () => {
    expect(paths({})).toEqual([]);
  });

  it('points at the bad member', () => {
    expect(paths({ name: '  ' })).toEqual(['r.name']);
    expect(paths({ email: 'nope' })).toEqual(['r.email']);
    expect(paths({ order: 0 })).toEqual(['r.order']);
    expect(paths({ order: 1.5 })).toEqual(['r.order']);
  });

  it('requires the contact the auth method needs', () => {
    expect(paths({ auth: 'sms_otp' })).toEqual(['r.phone']);
    expect(paths({ email: undefined, phone: '+919876543210', auth: 'email_otp' })).toEqual([
      'r.email',
    ]);
    expect(paths({ email: undefined, phone: '+919876543210', auth: 'sms_otp' })).toEqual([]);
  });

  it('requires some way to reach the recipient', () => {
    expect(paths({ email: undefined, auth: 'aadhaar' })).toEqual(['r.email']);
  });
});

describe('reminderIssues', () => {
  it('accepts sensible policies and the off switch', () => {
    expect(reminderIssues({ firstAfterDays: 3, everyDays: 2, max: 3 })).toEqual([]);
    expect(reminderIssues({ firstAfterDays: 0, everyDays: 0, max: 0 })).toEqual([]);
    expect(reminderIssues({ firstAfterDays: 2, everyDays: 0, max: 1 })).toEqual([]);
  });

  it('rejects negative or fractional values', () => {
    expect(
      reminderIssues({ firstAfterDays: -1, everyDays: 1.5, max: -2 }).map((i) => i.path),
    ).toEqual(['reminders.firstAfterDays', 'reminders.everyDays', 'reminders.max']);
  });

  it('needs a gap when several reminders are allowed', () => {
    expect(reminderIssues({ firstAfterDays: 1, everyDays: 0, max: 3 }).map((i) => i.path)).toEqual([
      'reminders.everyDays',
    ]);
  });
});

describe('rectIssues', () => {
  it('accepts a box that touches the page edges', () => {
    expect(rectIssues({ x: 0, y: 0, width: 612, height: 792 }, page, 'f')).toEqual([]);
  });

  it('rejects boxes outside the page', () => {
    expect(rectIssues({ x: -1, y: 0, width: 10, height: 10 }, page, 'f')).toHaveLength(1);
    expect(rectIssues({ x: 600, y: 0, width: 20, height: 10 }, page, 'f')).toHaveLength(1);
    expect(rectIssues({ x: 0, y: 790, width: 10, height: 10 }, page, 'f')).toHaveLength(1);
  });

  it('rejects empty and non-finite boxes', () => {
    expect(rectIssues({ x: 0, y: 0, width: 0, height: 10 }, page, 'f')).toHaveLength(1);
    expect(rectIssues({ x: Number.NaN, y: 0, width: 10, height: 10 }, page, 'f')).toHaveLength(1);
    expect(rectIssues({ x: 0, y: 0, width: Infinity, height: 10 }, page, 'f')).toHaveLength(1);
  });

  it('only checks the far edges when the page size is known', () => {
    expect(rectIssues({ x: 5000, y: 5000, width: 10, height: 10 }, undefined, 'f')).toEqual([]);
  });
});

describe('pageSizeIssues', () => {
  it('needs one positive size per page', () => {
    expect(pageSizeIssues([page], 1, 'p')).toEqual([]);
    expect(pageSizeIssues([page], 2, 'p')).toHaveLength(1);
    expect(pageSizeIssues([page, { width: 0, height: 1 }], 2, 'p')[0]!.path).toBe('p.1');
  });
});

describe('normalizePng', () => {
  it('accepts a PNG with or without the data URL prefix', () => {
    expect(normalizePng(PNG)).toEqual({ base64: PNG });
    expect(normalizePng(`data:image/png;base64,${PNG}`)).toEqual({ base64: PNG });
  });

  it('rejects bad base64', () => {
    expect(normalizePng('not base64!')).toEqual({ problem: 'Image is not valid base64' });
  });

  it('rejects other formats that merely claim to be images', () => {
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)));
    expect(normalizePng(jpeg)).toEqual({ problem: 'Image is not a PNG' });
    const truncated = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    expect(normalizePng(truncated)).toEqual({ problem: 'Image is not a PNG' });
  });

  it('rejects a PNG signature without an IHDR chunk', () => {
    const fake = btoa(
      String.fromCharCode(
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...new Array(30).fill(65),
      ),
    );
    expect(normalizePng(fake)).toEqual({ problem: 'Image is not a PNG' });
  });

  it('rejects images over the size cap', () => {
    const big = btoa(String.fromCharCode(...new Array(1024).fill(0))).repeat(
      Math.ceil(MAX_IMAGE_BYTES / 1024) + 1,
    );
    expect(normalizePng(big)).toMatchObject({ problem: expect.stringContaining('larger than') });
  });
});

describe('isIsoDate', () => {
  it.each(['2026-03-01', '2026-03-01T10:00:00Z', '2026-03-01T10:00:00.123+05:30', '2024-02-29'])(
    'accepts %s',
    (v) => {
      expect(isIsoDate(v)).toBe(true);
    },
  );

  it.each([
    '',
    '01/03/2026',
    '2026-13-01',
    '2026-02-30',
    '2025-02-29',
    '2026-03-01T25:00:00Z',
    '2026-3-1',
  ])('rejects %s', (v) => {
    expect(isIsoDate(v)).toBe(false);
  });
});

describe('checkFieldValue', () => {
  it('normalizes signature images', () => {
    expect(checkFieldValue('signature', `data:image/png;base64,${PNG}`)).toEqual({
      ok: true,
      value: PNG,
    });
    expect(checkFieldValue('initials', 'abcd')).toMatchObject({ ok: false });
  });

  it('accepts only true or false for checkboxes', () => {
    expect(checkFieldValue('checkbox', 'true')).toEqual({ ok: true, value: 'true' });
    expect(checkFieldValue('checkbox', 'yes')).toMatchObject({ ok: false });
  });

  it('caps text length and trims', () => {
    expect(checkFieldValue('text', '  hi  ')).toEqual({ ok: true, value: 'hi' });
    expect(checkFieldValue('text', 'x'.repeat(MAX_TEXT_LENGTH))).toMatchObject({ ok: true });
    expect(checkFieldValue('text', 'x'.repeat(MAX_TEXT_LENGTH + 1))).toMatchObject({ ok: false });
    expect(checkFieldValue('name', 'x'.repeat(201))).toMatchObject({ ok: false });
  });

  it('checks dates', () => {
    expect(checkFieldValue('date_signed', '2026-03-01')).toMatchObject({ ok: true });
    expect(checkFieldValue('date_signed', 'yesterday')).toMatchObject({ ok: false });
  });
});

describe('isFilled', () => {
  const field = (type: Field['type']) => ({ type }) as Field;

  it('needs a non-empty value, and a ticked box for checkboxes', () => {
    expect(isFilled(field('text'), 'a')).toBe(true);
    expect(isFilled(field('text'), '')).toBe(false);
    expect(isFilled(field('text'), undefined)).toBe(false);
    expect(isFilled(field('checkbox'), 'true')).toBe(true);
    expect(isFilled(field('checkbox'), 'false')).toBe(false);
  });
});
