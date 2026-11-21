import { SignError } from '@codevibe_technology/sign-core';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFObject,
} from 'pdf-lib';

/** A signature value as the document's form declares it. */
export interface SignatureField {
  byteRange: [number, number, number, number];
  /** The /Contents hex string exactly as written in the file. */
  contentsHex: string;
  /** Raw /M date string, when present. */
  signingDate?: string;
}

const MAX_FIELD_NODES = 10_000;

const name = (value: string) => PDFName.of(value);

function resolve(doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function readByteRange(value: PDFObject | undefined): SignatureField['byteRange'] | undefined {
  if (!(value instanceof PDFArray) || value.size() !== 4) {
    return undefined;
  }
  const numbers = value
    .asArray()
    .map((item) => (item instanceof PDFNumber ? item.asNumber() : NaN));
  if (!numbers.every((n) => Number.isSafeInteger(n) && n >= 0)) {
    return undefined;
  }
  return numbers as SignatureField['byteRange'];
}

/**
 * Lists the signed signature fields of the document's AcroForm (fields of type /Sig that
 * have a value), in form order. Text that merely looks like a signature dictionary, but that
 * no field references, is ignored. A file pdf-lib cannot read has no signatures.
 */
export async function signatureFields(bytes: Uint8Array): Promise<SignatureField[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return [];
  }
  return signatureFieldsOf(doc);
}

/** `signatureFields` for a document that is already loaded. */
export function signatureFieldsOf(doc: PDFDocument): SignatureField[] {
  try {
    const form = resolve(doc, doc.catalog.get(name('AcroForm')));
    if (!(form instanceof PDFDict)) {
      return [];
    }
    const roots = resolve(doc, form.get(name('Fields')));
    if (!(roots instanceof PDFArray)) {
      return [];
    }

    const found: SignatureField[] = [];
    const seenNodes = new Set<PDFDict>();
    const seenValues = new Set<PDFDict>();
    const stack: { node: PDFObject | undefined; type?: PDFName }[] = roots
      .asArray()
      .map((node) => ({ node }))
      .reverse();

    while (stack.length > 0 && seenNodes.size < MAX_FIELD_NODES) {
      const entry = stack.pop()!;
      const node = resolve(doc, entry.node);
      if (!(node instanceof PDFDict) || seenNodes.has(node)) {
        continue;
      }
      seenNodes.add(node);
      const ownType = resolve(doc, node.get(name('FT')));
      const type = ownType instanceof PDFName ? ownType : entry.type;

      const value = resolve(doc, node.get(name('V')));
      if (type === name('Sig') && value instanceof PDFDict && !seenValues.has(value)) {
        seenValues.add(value);
        const byteRange = readByteRange(resolve(doc, value.get(name('ByteRange'))));
        const contents = resolve(doc, value.get(name('Contents')));
        const date = resolve(doc, value.get(name('M')));
        if (byteRange && contents instanceof PDFHexString) {
          found.push({
            byteRange,
            contentsHex: contents.asString(),
            ...(date instanceof PDFString ? { signingDate: date.asString() } : {}),
          });
        } else {
          found.push({ byteRange: [0, 0, 0, 0], contentsHex: '' });
        }
      }

      const kids = resolve(doc, node.get(name('Kids')));
      if (kids instanceof PDFArray) {
        for (const kid of kids.asArray().reverse()) {
          stack.push({ node: kid, ...(type ? { type } : {}) });
        }
      }
    }
    return found;
  } catch {
    return [];
  }
}

export const ALREADY_SIGNED_MESSAGE =
  'This PDF already carries digital signatures. Signing it again here would remove them. Upload the unsigned original.';

/**
 * Refuses a document that carries signed signature fields. Every step that writes the file
 * again (drawing fields, flattening forms, sealing) would destroy those signatures, so a
 * signed file is turned away instead of silently losing them.
 */
export function assertUnsigned(doc: PDFDocument): void {
  const count = signatureFieldsOf(doc).length;
  if (count > 0) {
    throw new SignError('PDF_ALREADY_SIGNED', ALREADY_SIGNED_MESSAGE, { signatureCount: count });
  }
}
