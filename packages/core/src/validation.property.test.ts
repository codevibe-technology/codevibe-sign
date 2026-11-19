import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PNG } from './test/fixtures';
import type { FieldType } from './types';
import {
  checkFieldValue,
  isIsoDate,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from './validation';

const PNG_HEADER = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
];
const PNG_BYTES = Uint8Array.from(Buffer.from(PNG, 'base64'));

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function pngWith(width: number, height: number, tail: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(PNG_BYTES.length + tail.length);
  bytes.set(PNG_BYTES);
  bytes.set(tail, PNG_BYTES.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** What an accepted image must look like once decoded. */
function assertSafePng(stored: string): void {
  const bytes = Buffer.from(stored, 'base64');
  expect(bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
  expect([...bytes.subarray(0, 16)]).toEqual(PNG_HEADER);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
  expect(height).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
}

const imageType = fc.constantFrom<FieldType>('signature', 'initials');

const dimension = fc.oneof(
  fc.integer({ min: 0, max: MAX_IMAGE_DIMENSION + 10 }),
  fc.integer({ min: 0, max: 0xffffffff }),
);

const imageInput = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.uint8Array({ maxLength: 200 }).map(b64),
  fc.uint8Array({ maxLength: 64 }).map((tail) => b64(Uint8Array.from([...PNG_HEADER, ...tail]))),
  fc
    .tuple(dimension, dimension, fc.uint8Array({ maxLength: 64 }))
    .map(([w, h, tail]) => b64(pngWith(w, h, tail))),
  fc
    .tuple(
      fc.constantFrom(
        'data:image/png;base64,',
        'data:image/svg+xml;base64,',
        'data:image/jpeg;base64,',
        'data:text/html;base64,',
        'DATA:image/png;base64,',
        '',
      ),
      fc.constantFrom(PNG, b64(new TextEncoder().encode('<svg onload="alert(1)"/>'))),
    )
    .map(([prefix, body]) => prefix + body),
);

describe('field value properties', () => {
  it('an accepted signature or initials value is always a small, real PNG', () => {
    fc.assert(
      fc.property(imageType, imageInput, (type, raw) => {
        const result = checkFieldValue(type, raw);
        if (result.ok) assertSafePng(result.value);
      }),
      { numRuns: 1000 },
    );
  });

  it('never accepts a declared canvas larger than the pixel cap', () => {
    fc.assert(
      fc.property(imageType, dimension, dimension, (type, width, height) => {
        const result = checkFieldValue(type, b64(pngWith(width, height, new Uint8Array())));
        const allowed = width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION;
        expect(result.ok).toBe(allowed);
      }),
    );
  });

  it('never accepts an image over the byte cap, whatever its header', () => {
    fc.assert(
      fc.property(
        imageType,
        fc.integer({ min: 1, max: 4096 }),
        fc.boolean(),
        (type, extra, prefixed) => {
          const tail = new Uint8Array(MAX_IMAGE_BYTES - PNG_BYTES.length + extra);
          const body = b64(pngWith(1, 1, tail));
          const result = checkFieldValue(type, prefixed ? `data:image/png;base64,${body}` : body);
          expect(result).toMatchObject({ ok: false, problem: expect.stringContaining('KB') });
        },
      ),
      { numRuns: 20 },
    );
  });

  it('text and names are trimmed and never longer than their cap', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<FieldType>('text', 'name'),
        fc.string({ maxLength: MAX_TEXT_LENGTH + 50 }),
        (type, raw) => {
          const result = checkFieldValue(type, raw);
          const max = type === 'name' ? MAX_NAME_LENGTH : MAX_TEXT_LENGTH;
          if (result.ok) {
            expect(result.value).toBe(raw.trim());
            expect(result.value.length).toBeLessThanOrEqual(max);
          } else {
            expect(raw.trim().length).toBeGreaterThan(max);
          }
        },
      ),
    );
  });

  it('checkboxes accept exactly true or false', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom('true', 'false', 'TRUE', ' true')),
        (raw) => {
          expect(checkFieldValue('checkbox', raw).ok).toBe(raw === 'true' || raw === 'false');
        },
      ),
    );
  });

  it('dates are accepted only when they are real ISO dates, and are stored unchanged', () => {
    const date = fc
      .integer({ min: Date.UTC(1900, 0, 1), max: Date.UTC(2200, 0, 1) })
      .map((ms) => new Date(ms).toISOString());
    fc.assert(
      fc.property(
        fc.oneof(
          date,
          date.map((d) => d.slice(0, 10)),
          fc.string({ maxLength: 30 }),
        ),
        (raw) => {
          const result = checkFieldValue('date_signed', raw);
          expect(result.ok).toBe(isIsoDate(raw));
          if (result.ok) {
            expect(result.value).toBe(raw);
            expect(Number.isNaN(Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw))).toBe(
              false,
            );
          }
        },
      ),
    );
  });
});
