import { degrees, rgb, type PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  SignError,
  type Field,
  type FieldValue,
  type Recipient,
} from '@codevibe_technology/sign-core';
import { embedFonts, type FontSet } from './fonts';
import { boxFrame, clampRect, fitContain, pageGeometry, type BoxFrame } from './geometry';
import { loadPdf } from './inspect';
import { sanitizeDocument } from './sanitize';
import { reencodePng } from './png';
import { fitText, LINE_HEIGHT } from './text';
import type { Face } from './typeset';
import { assertTimeZone, formatSigningDate, formatSigningTime } from './time';

export interface RenderOptions {
  /** Draw only the fields that belong to this document. */
  documentId?: string;
  /**
   * TrueType or OpenType font tried first for text and names. Without one, text the standard
   * fonts cannot draw uses the bundled Noto fonts.
   */
  font?: Uint8Array;
  /** IANA time zone used to turn a date-signed timestamp into a calendar date. */
  timeZone?: string;
  /** Custom date text for `date_signed` fields. Receives the stored ISO value. */
  formatDate?: (value: string) => string;
  /** Largest accepted signature or initials image, in bytes. Defaults to 1 MB. */
  maxImageBytes?: number;
  /** Largest accepted input PDF, in bytes. Defaults to 25 MB. */
  maxBytes?: number;
  /**
   * Print the signer's name and signing time in small type at the foot of each signature
   * box, under the drawn signature. Defaults to true. Boxes under 20 points tall are left
   * without it.
   */
  signatureCaption?: boolean;
  /**
   * The eSign provider an Aadhaar eSign box names, for example "Leegality". Without one the
   * box says only that the signature is an Aadhaar eSign.
   */
  esignProvider?: string;
}

const INK = rgb(0.08, 0.09, 0.13);
const CAPTION_INK = rgb(0.35, 0.38, 0.44);
const AADHAAR_INK = rgb(0.11, 0.42, 0.88);
const AADHAAR_GROUND = rgb(0.96, 0.975, 1);
const CAPTION_MIN_BOX_HEIGHT = 20;
const CAPTION_MAX_SIZE = 7;
const CAPTION_MIN_SIZE = 3;
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

/** Draws the image centred in the box, above a strip of `reserved` points at its foot. */
function drawImage(page: PDFPage, frame: BoxFrame, image: PDFImage, reserved = 0): void {
  const fit = fitContain(image.width, image.height, frame.width, frame.height - reserved);
  const origin = frame.at(fit.x, fit.y + reserved);
  page.drawImage(image, {
    x: origin.x,
    y: origin.y,
    width: fit.width,
    height: fit.height,
    rotate: degrees(frame.rotate),
  });
}

function drawText(page: PDFPage, frame: BoxFrame, text: string, font: Face): void {
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
    font.draw(page, line, {
      x: origin.x,
      y: origin.y,
      size: fitted.size,
      color: INK,
      rotate: frame.rotate,
    });
  });
}

/** Height of the caption strip for a signature box, or 0 when the box is too small for one. */
function captionStrip(frame: BoxFrame): number {
  if (frame.height < CAPTION_MIN_BOX_HEIGHT) {
    return 0;
  }
  const size = Math.min(CAPTION_MAX_SIZE, Math.max(CAPTION_MIN_SIZE + 1, frame.height * 0.14));
  return size * LINE_HEIGHT;
}

/** "Asha Rao, 19 Nov 2026 15:45 GMT+5:30" on one line, shrunk or shortened to fit the box. */
function drawCaption(
  page: PDFPage,
  frame: BoxFrame,
  strip: number,
  text: string,
  font: Face,
): void {
  const fitted = fitText(text, font, frame.width, strip, {
    minSize: CAPTION_MIN_SIZE,
    maxSize: CAPTION_MAX_SIZE,
  });
  const line = fitted.lines[0];
  if (!line) {
    return;
  }
  const width = font.widthOfTextAtSize(line, fitted.size);
  const descent =
    font.heightAtSize(fitted.size) - font.heightAtSize(fitted.size, { descender: false });
  const origin = frame.at(Math.max(0, (frame.width - width) / 2), descent + 0.5);
  font.draw(page, line, {
    x: origin.x,
    y: origin.y,
    size: fitted.size,
    color: CAPTION_INK,
    rotate: frame.rotate,
  });
}

function captionText(recipient: Recipient, timeZone: string | undefined): string {
  const when = recipient.actedAt ? formatSigningTime(recipient.actedAt, timeZone) : undefined;
  return [recipient.name.trim(), when].filter(Boolean).join(', ');
}

/**
 * Marks the place of an Aadhaar eSign: a framed box with "Aadhaar eSign", the signer's name
 * and the provider. It is drawn on the file sent to the provider, so it is part of what the
 * signer signs; the digital signature itself is the provider's and is not drawn here.
 */
function drawAadhaarBox(
  page: PDFPage,
  frame: BoxFrame,
  recipient: Recipient,
  provider: string | undefined,
  fonts: FontSet,
): void {
  const border = Math.max(0.5, Math.min(frame.width, frame.height) * 0.02);
  const corner = (fx: number, fy: number) => frame.at(frame.width * fx, frame.height * fy);
  // An opaque ground, like a drawn signature, so the box reads clearly over page text.
  const bottomLeft = corner(0, 0);
  page.drawRectangle({
    x: bottomLeft.x,
    y: bottomLeft.y,
    width: frame.width,
    height: frame.height,
    rotate: degrees(frame.rotate),
    color: AADHAAR_GROUND,
  });
  const edge = (from: [number, number], to: [number, number]) =>
    page.drawLine({
      start: corner(...from),
      end: corner(...to),
      thickness: border,
      color: AADHAAR_INK,
    });
  edge([0, 0], [1, 0]);
  edge([1, 0], [1, 1]);
  edge([1, 1], [0, 1]);
  edge([0, 1], [0, 0]);

  const padding = Math.min(4, frame.height * 0.08);
  const width = frame.width - padding * 2;
  const via = provider?.trim()
    ? `Signed with Aadhaar OTP via ${provider.trim()}`
    : 'Signed with Aadhaar OTP';
  const lines: { text: string; font: Face; share: number; color: typeof INK }[] = [
    { text: 'Aadhaar eSign', font: fonts.bold, share: 0.28, color: AADHAAR_INK },
    { text: recipient.name.trim(), font: fonts.regular, share: 0.4, color: INK },
    { text: via, font: fonts.regular, share: 0.32, color: CAPTION_INK },
  ];
  let top = frame.height - padding;
  const room = frame.height - padding * 2;
  for (const line of lines) {
    const height = room * line.share;
    const fitted = fitText(line.text, line.font, width, height, {
      minSize: CAPTION_MIN_SIZE,
      maxSize: 14,
    });
    const text = fitted.lines[0];
    top -= height;
    if (!text) continue;
    const descent =
      line.font.heightAtSize(fitted.size) -
      line.font.heightAtSize(fitted.size, { descender: false });
    const origin = frame.at(padding, top + (height - fitted.size * LINE_HEIGHT) / 2 + descent);
    line.font.draw(page, text, {
      x: origin.x,
      y: origin.y,
      size: fitted.size,
      color: line.color,
      rotate: frame.rotate,
    });
  }
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
 * text, names and dates, and checkboxes. Each signature carries the signer's name and
 * signing time in small type at the foot of its box (see `signatureCaption`). Field rects use core's top-left origin as the
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
    if (!field.required || field.type === 'aadhaar') {
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
        const caption =
          field.type === 'signature' && options.signatureCaption !== false
            ? captionText(recipient, options.timeZone)
            : '';
        const strip = caption ? captionStrip(frame) : 0;
        drawImage(page, frame, image, strip);
        if (strip > 0) {
          fonts ??= await embedFonts(doc, options.font);
          drawCaption(page, frame, strip, caption, fonts.regular);
        }
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
      case 'aadhaar': {
        fonts ??= await embedFonts(doc, options.font);
        drawAadhaarBox(page, frame, recipient, options.esignProvider, fonts);
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
        drawText(page, frame, text, fonts.regular);
        break;
      }
    }
  }

  await fonts?.finish();
  return doc.save();
}
