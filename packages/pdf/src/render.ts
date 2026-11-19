import { degrees, rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  SignError,
  type Field,
  type FieldValue,
  type Recipient,
} from '@codevibe_technology/sign-core';
import { canEncode, embedFonts, type FontSet } from './fonts';
import { boxFrame, clampRect, fitContain, pageGeometry, type BoxFrame } from './geometry';
import { loadPdf } from './inspect';
import { sanitizeDocument } from './sanitize';
import { reencodePng } from './png';
import { fitText, LINE_HEIGHT } from './text';
import { assertTimeZone, formatSigningDate } from './time';

export interface RenderOptions {
  /** Draw only the fields that belong to this document. */
  documentId?: string;
  /** TrueType or OpenType font for text and names outside Latin script. */
  font?: Uint8Array;
  /** IANA time zone used to turn a date-signed timestamp into a calendar date. */
  timeZone?: string;
  /** Custom date text for `date_signed` fields. Receives the stored ISO value. */
  formatDate?: (value: string) => string;
  /** Largest accepted signature or initials image, in bytes. Defaults to 1 MB. */
  maxImageBytes?: number;
  /** Largest accepted input PDF, in bytes. Defaults to 25 MB. */
  maxBytes?: number;
}

const INK = rgb(0.08, 0.09, 0.13);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DEFAULT_MAX_IMAGE_BYTES = 1024 * 1024;

function decodePng(field: Field, value: string, maxBytes: number): Uint8Array {
  const base64 = value.replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    throw new SignError('INVALID_FIELD_VALUE', 'The signature image is not valid base64.', {
      fieldId: field.id,
    });
  }
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  if (bytes.byteLength > maxBytes) {
    throw new SignError(
      'INVALID_FIELD_VALUE',
      `The signature image is larger than ${maxBytes} bytes.`,
      {
        fieldId: field.id,
        size: bytes.byteLength,
        maxBytes,
      },
    );
  }
  if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new SignError('INVALID_FIELD_VALUE', 'The signature image must be a PNG.', {
      fieldId: field.id,
    });
  }
  return bytes;
}

/** The image is re-encoded under limits first, so pdf-lib's decoder only sees a clean PNG. */
async function embedPng(doc: PDFDocument, field: Field, bytes: Uint8Array): Promise<PDFImage> {
  try {
    return await doc.embedPng(reencodePng(bytes));
  } catch {
    throw new SignError('INVALID_FIELD_VALUE', 'The signature image could not be read.', {
      fieldId: field.id,
    });
  }
}

function drawImage(page: PDFPage, frame: BoxFrame, image: PDFImage): void {
  const fit = fitContain(image.width, image.height, frame.width, frame.height);
  const origin = frame.at(fit.x, fit.y);
  page.drawImage(image, {
    x: origin.x,
    y: origin.y,
    width: fit.width,
    height: fit.height,
    rotate: degrees(frame.rotate),
  });
}

function drawText(page: PDFPage, frame: BoxFrame, text: string, font: PDFFont): void {
  const padding = 2;
  const fitted = fitText(text, font, frame.width, frame.height);
  const lineHeight = fitted.size * LINE_HEIGHT;
  const fullHeight = font.heightAtSize(fitted.size);
  const descent = fullHeight - font.heightAtSize(fitted.size, { descender: false });
  const blockTop = frame.height - (frame.height - fitted.lines.length * lineHeight) / 2;

  fitted.lines.forEach((line, index) => {
    const lineBottom = blockTop - (index + 1) * lineHeight;
    const baseline = lineBottom + (lineHeight - fullHeight) / 2 + descent;
    const origin = frame.at(padding, baseline);
    page.drawText(line, {
      x: origin.x,
      y: origin.y,
      size: fitted.size,
      font,
      color: INK,
      rotate: degrees(frame.rotate),
    });
  });
}

function drawCheckbox(page: PDFPage, frame: BoxFrame, checked: boolean): void {
  const side = Math.min(frame.width, frame.height) * 0.9;
  const left = (frame.width - side) / 2;
  const bottom = (frame.height - side) / 2;
  const point = (fx: number, fy: number) => frame.at(left + side * fx, bottom + side * fy);
  const line = (from: [number, number], to: [number, number], thickness: number) =>
    page.drawLine({ start: point(...from), end: point(...to), thickness, color: INK });

  const border = Math.max(0.5, side * 0.06);
  line([0, 0], [1, 0], border);
  line([1, 0], [1, 1], border);
  line([1, 1], [0, 1], border);
  line([0, 1], [0, 0], border);
  if (checked) {
    const tick = Math.max(0.75, side * 0.1);
    line([0.2, 0.52], [0.42, 0.28], tick);
    line([0.42, 0.28], [0.8, 0.76], tick);
  }
}

function textFor(
  field: Field,
  value: string | undefined,
  recipient: Recipient,
  options: RenderOptions,
): string | undefined {
  if (field.type === 'name') {
    return value || recipient.name;
  }
  if (field.type === 'date_signed') {
    const raw = value || recipient.actedAt;
    if (!raw) {
      return undefined;
    }
    return options.formatDate ? options.formatDate(raw) : formatSigningDate(raw, options.timeZone);
  }
  return value || undefined;
}

/**
 * Draws every field value onto the original pages: signature and initials images,
 * text, names and dates, and checkboxes. Field rects use core's top-left origin as the
 * page is displayed; rotated pages and offset crop boxes are handled. The pages are first
 * copied into a fresh document without active content and with form fields flattened (see
 * `sanitizeDocument`), so the file that is sealed holds only what the signer saw.
 */
export async function renderFields(
  pdfBytes: Uint8Array,
  fields: Field[],
  values: FieldValue[],
  recipients: Recipient[],
  options: RenderOptions = {},
): Promise<Uint8Array> {
  if (options.timeZone) {
    assertTimeZone(options.timeZone);
  }
  const doc = await sanitizeDocument(await loadPdf(pdfBytes, { maxBytes: options.maxBytes }));
  let fonts: FontSet | undefined;
  const pages = doc.getPages();
  const valueByField = new Map(values.map((entry) => [entry.fieldId, entry.value]));
  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  const selected = fields.filter(
    (field) => options.documentId === undefined || field.documentId === options.documentId,
  );

  const missing = selected.filter((field) => {
    if (!field.required) {
      return false;
    }
    const value = valueByField.get(field.id);
    const recipient = recipientById.get(field.recipientId);
    if (field.type === 'name') {
      return !value && !recipient?.name;
    }
    if (field.type === 'date_signed') {
      return !value && !recipient?.actedAt;
    }
    return value === undefined || value === '';
  });
  if (missing.length > 0) {
    throw new SignError('REQUIRED_FIELDS_MISSING', 'Some required fields have no value.', {
      fieldIds: missing.map((field) => field.id),
    });
  }

  const images = new Map<string, PDFImage>();

  for (const field of selected) {
    const page = Number.isInteger(field.page) ? pages[field.page] : undefined;
    if (!page) {
      throw new SignError(
        'VALIDATION',
        `Field is on page ${field.page + 1}, but the PDF has ${pages.length} pages.`,
        {
          fieldId: field.id,
          page: field.page,
          pageCount: pages.length,
        },
      );
    }
    const recipient = recipientById.get(field.recipientId);
    if (!recipient) {
      throw new SignError('RECIPIENT_NOT_FOUND', 'The field belongs to an unknown recipient.', {
        fieldId: field.id,
        recipientId: field.recipientId,
      });
    }

    const geometry = pageGeometry(page);
    const rect = clampRect(geometry, field.rect);
    if (!rect) {
      throw new SignError('VALIDATION', 'The field box lies outside the page.', {
        fieldId: field.id,
        rect: field.rect,
      });
    }
    const frame = boxFrame(geometry, rect);
    const value = valueByField.get(field.id);

    switch (field.type) {
      case 'signature':
      case 'initials': {
        if (!value) {
          break;
        }
        const bytes = decodePng(field, value, maxImageBytes);
        let image = images.get(value);
        if (!image) {
          image = await embedPng(doc, field, bytes);
          images.set(value, image);
        }
        drawImage(page, frame, image);
        break;
      }
      case 'checkbox': {
        if (value === undefined || value === '') {
          break;
        }
        if (value !== 'true' && value !== 'false') {
          throw new SignError(
            'INVALID_FIELD_VALUE',
            "A checkbox value must be 'true' or 'false'.",
            {
              fieldId: field.id,
            },
          );
        }
        drawCheckbox(page, frame, value === 'true');
        break;
      }
      case 'text':
      case 'name':
      case 'date_signed': {
        const text = textFor(field, value, recipient, options);
        if (!text) {
          break;
        }
        fonts ??= await embedFonts(doc, options.font);
        if (!canEncode(fonts.regular, text)) {
          throw new SignError(
            'INVALID_FIELD_VALUE',
            'The text uses characters the standard font cannot draw. Pass a font that covers them in options.font.',
            { fieldId: field.id, option: 'font' },
          );
        }
        drawText(page, frame, text, fonts.regular);
        break;
      }
    }
  }

  return doc.save();
}
