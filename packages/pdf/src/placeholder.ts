import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
} from 'pdf-lib';
import { DEFAULT_BYTE_RANGE_PLACEHOLDER, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';

/**
 * `certification`: the first signature in a file, with DocMDP permissions (P=1, no changes
 * allowed); readers show the file as certified and flag any later edit. `approval`: an
 * ordinary signature, the only kind allowed after another signature.
 */
export type SignatureKind = 'certification' | 'approval';

/** Certification is only possible for the first signature in a file. */
export function signatureKind(existingSignatures: number, certify: boolean): SignatureKind {
  return certify && existingSignatures === 0 ? 'certification' : 'approval';
}

export interface PlaceholderOptions {
  kind: SignatureKind;
  reason: string;
  location: string;
  contactInfo: string;
  name: string;
  signingTime: Date;
  /** Bytes reserved for the CMS structure; the file holds twice as many hex digits. */
  signatureLength: number;
}

const DOCMDP_NO_CHANGES = 1;
const SIG_FLAGS_SIGNATURES_EXIST = 1;
const SIG_FLAGS_APPEND_ONLY = 2;
const ANNOTATION_PRINT = 4;

const text = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) > 127)
    ? PDFHexString.fromText(value)
    : PDFString.of(value);

/**
 * Adds an invisible signature field whose value is an empty signature dictionary: a /ByteRange
 * placeholder and /Contents of zeros, filled in by `SignPdf` once the file is written. For a
 * certification signature it also adds the DocMDP transform reference and the catalog's
 * /Perms entry that points at the signature.
 */
export function addSignaturePlaceholder(doc: PDFDocument, options: PlaceholderOptions): void {
  const { context } = doc;
  const page = doc.getPages()[0]!;
  const byteRange = PDFArray.withContext(context);
  byteRange.push(PDFNumber.of(0));
  for (let index = 0; index < 3; index += 1) {
    byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));
  }

  const reference =
    options.kind === 'certification'
      ? {
          Reference: [
            {
              Type: 'SigRef',
              TransformMethod: 'DocMDP',
              TransformParams: { Type: 'TransformParams', P: DOCMDP_NO_CHANGES, V: '1.2' },
            },
          ],
        }
      : {};
  const signature = context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: SUBFILTER_ETSI_CADES_DETACHED,
    ByteRange: byteRange,
    Contents: PDFHexString.of('0'.repeat(options.signatureLength * 2)),
    Reason: text(options.reason),
    M: PDFString.fromDate(options.signingTime),
    ContactInfo: text(options.contactInfo),
    Name: text(options.name),
    Location: text(options.location),
    Prop_Build: { Filter: { Name: 'Adobe.PPKLite' } },
    ...reference,
  });
  // Written as raw bytes so pdf-lib never moves it into an object stream, where the byte
  // range could not point at it.
  const bytes = new Uint8Array(signature.sizeInBytes());
  signature.copyBytesInto(bytes, 0);
  const signatureRef = context.register(PDFInvalidObject.of(bytes));

  const appearance = context.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} });
  const widget = context.register(
    context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: [0, 0, 0, 0],
      V: signatureRef,
      T: PDFString.of('Seal'),
      F: ANNOTATION_PRINT,
      P: page.ref,
      AP: { N: context.register(appearance) },
    }),
  );

  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray) ?? context.obj([]);
  annotations.push(widget);
  page.node.set(PDFName.of('Annots'), annotations);

  let form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!form) {
    form = context.obj({ Fields: [] });
    doc.catalog.set(PDFName.of('AcroForm'), context.register(form));
  }
  const flags = form.lookupMaybe(PDFName.of('SigFlags'), PDFNumber)?.asNumber() ?? 0;
  form.set(
    PDFName.of('SigFlags'),
    PDFNumber.of(flags | SIG_FLAGS_SIGNATURES_EXIST | SIG_FLAGS_APPEND_ONLY),
  );
  let fields = form.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) {
    fields = context.obj([]);
    form.set(PDFName.of('Fields'), fields);
  }
  fields.push(widget);

  if (options.kind === 'certification') {
    doc.catalog.set(PDFName.of('Perms'), context.obj({ DocMDP: signatureRef }));
  }
}
