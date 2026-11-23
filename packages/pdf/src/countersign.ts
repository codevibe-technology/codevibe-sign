import { createHash } from 'node:crypto';
import { SignError } from '@codevibe_technology/sign-core';
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { assertSealChain, buildCadesSignature } from './cms';
import { loadPdf } from './inspect';
import {
  DEFAULT_REASON,
  parseCertificate,
  placeholderSize,
  sealProvider,
  timestamper,
  type SealOptions,
} from './seal';
import { signatureFieldsOf } from './signatures';

const SIG_FLAGS = 3;
const ANNOTATION_PRINT_LOCKED = 132;
const DOCMDP_NO_CHANGES = 1;
const MAX_FIELD_NODES = 10_000;
/** Stands in for the byte range until the layout of the update is known. */
const BYTE_RANGE_SLOT = `/${'B'.repeat(48)}`;

const name = (value: string) => PDFName.of(value);
const latin1 = (value: string) => Buffer.from(value, 'latin1');

const text = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) > 127)
    ? PDFHexString.fromText(value)
    : PDFString.of(value);

function refuse(message: string, reason: string): never {
  throw new SignError('DOCUMENT_INVALID', message, { reason, step: 'countersign' });
}

function locked(message: string): never {
  throw new SignError('PDF_ALREADY_SIGNED', message, { reason: 'locked', step: 'countersign' });
}

interface LastSection {
  /** Offset the file's last `startxref` points at. */
  offset: number;
  /** Whether that section is a cross-reference stream rather than a table. */
  stream: boolean;
}

/** Finds the cross-reference section the last `startxref` of the file points at. */
function lastSection(bytes: Buffer): LastSection {
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1');
  const matches = [...tail.matchAll(/startxref\s+(\d+)\s+%%EOF/g)];
  const offset = Number(matches[matches.length - 1]?.[1] ?? Number.NaN);
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= bytes.length) {
    refuse('The PDF has no readable cross-reference table.', 'unreadable');
  }
  const head = bytes.subarray(offset, offset + 32).toString('latin1');
  if (/^\s*xref/.test(head)) {
    return { offset, stream: false };
  }
  if (/^\s*\d+\s+\d+\s+obj/.test(head)) {
    return { offset, stream: true };
  }
  return refuse('The PDF has no readable cross-reference table.', 'unreadable');
}

/**
 * The largest /Size a trailer or a cross-reference stream of the file declares, so no listed
 * object number is reused. A /Size anywhere else, such as the parameters of an embedded file,
 * is not an object count and is ignored.
 */
function declaredSize(bytes: Buffer): number {
  const text = bytes.toString('latin1');
  let size = 0;
  const take = (dictionary: string) => {
    for (const match of dictionary.matchAll(/\/Size\s+(\d{1,10})\b/g)) {
      size = Math.max(size, Number(match[1]));
    }
  };
  for (const match of text.matchAll(/\btrailer\b/g)) {
    const end = text.indexOf('startxref', match.index);
    take(text.slice(match.index, end === -1 ? match.index + 4096 : end));
  }
  for (const match of text.matchAll(/\/Type\s*\/XRef\b/g)) {
    const start = text.lastIndexOf(' obj', match.index);
    const end = text.indexOf('stream', match.index);
    if (start !== -1 && end !== -1 && end - start < 4096) {
      take(text.slice(start, end));
    }
  }
  return size;
}

function lookup(doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function dictOf(doc: PDFDocument, value: PDFObject | undefined): PDFDict | undefined {
  const resolved = lookup(doc, value);
  return resolved instanceof PDFDict ? resolved : undefined;
}

function arrayOf(doc: PDFDocument, value: PDFObject | undefined): PDFArray | undefined {
  const resolved = lookup(doc, value);
  return resolved instanceof PDFArray ? resolved : undefined;
}

function numberOf(doc: PDFDocument, value: PDFObject | undefined): number | undefined {
  const resolved = lookup(doc, value);
  return resolved instanceof PDFNumber ? resolved.asNumber() : undefined;
}

function nameOf(doc: PDFDocument, value: PDFObject | undefined): string | undefined {
  const resolved = lookup(doc, value);
  return resolved instanceof PDFName ? resolved.decodeText() : undefined;
}

/** Whether a FieldMDP or /Lock dictionary locks fields beyond the ones it lists. */
function locksOtherFields(doc: PDFDocument, params: PDFDict | undefined): boolean {
  if (!params) {
    return false;
  }
  const action = nameOf(doc, params.get(name('Action')));
  return (
    action === 'All' ||
    action === 'Exclude' ||
    numberOf(doc, params.get(name('P'))) === DOCMDP_NO_CHANGES
  );
}

/**
 * Refuses a file whose signatures do not allow another one: a certification that permits no
 * changes (DocMDP P=1), or a field lock that covers fields it does not name. Adding a
 * signature to such a file would make readers report the earlier signature as broken.
 */
function assertOpenForSigning(doc: PDFDocument, form: PDFDict): void {
  const stack: (PDFObject | undefined)[] = [
    ...(arrayOf(doc, form.get(name('Fields')))?.asArray() ?? []),
  ];
  const seen = new Set<PDFDict>();
  while (stack.length > 0 && seen.size < MAX_FIELD_NODES) {
    const node = dictOf(doc, stack.pop());
    if (!node || seen.has(node)) {
      continue;
    }
    seen.add(node);
    stack.push(...(arrayOf(doc, node.get(name('Kids')))?.asArray() ?? []));

    const value = dictOf(doc, node.get(name('V')));
    if (!value || !value.has(name('ByteRange'))) {
      continue;
    }
    if (locksOtherFields(doc, dictOf(doc, node.get(name('Lock'))))) {
      locked('A signature in the PDF locks the form, so no further signature can be added.');
    }
    for (const entry of arrayOf(doc, value.get(name('Reference')))?.asArray() ?? []) {
      const reference = dictOf(doc, entry);
      const method = nameOf(doc, reference?.get(name('TransformMethod')));
      const params = dictOf(doc, reference?.get(name('TransformParams')));
      if (method === 'DocMDP') {
        // A missing P means 2: form filling and signing stay allowed.
        if (numberOf(doc, params?.get(name('P'))) === DOCMDP_NO_CHANGES) {
          locked('The PDF is certified with no changes allowed, so no signature can be added.');
        }
      } else if (method === 'FieldMDP' && locksOtherFields(doc, params)) {
        locked('A signature in the PDF locks the form, so no further signature can be added.');
      }
    }
  }
}

function uniqueFieldName(doc: PDFDocument, fields: PDFArray): string {
  const taken = new Set<string>();
  for (const entry of fields.asArray()) {
    const title = lookup(doc, dictOf(doc, entry)?.get(name('T')));
    if (title instanceof PDFString || title instanceof PDFHexString) {
      taken.add(title.decodeText());
    }
  }
  let candidate = 'Seal';
  for (let index = 2; taken.has(candidate); index += 1) {
    candidate = `Seal${index}`;
  }
  return candidate;
}

function serialise(ref: PDFRef, object: PDFObject): Buffer {
  const body = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(body, 0);
  return Buffer.concat([
    latin1(`${ref.objectNumber} ${ref.generationNumber} obj\n`),
    body,
    latin1('\nendobj\n'),
  ]);
}

interface Written {
  ref: PDFRef;
  offset: number;
}

/** Consecutive object numbers as `[first, count]` runs, the way a cross-reference lists them. */
function runs(written: Written[]): Written[][] {
  const groups: Written[][] = [];
  for (const entry of written) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    if (group && previous && previous.ref.objectNumber + 1 === entry.ref.objectNumber) {
      group.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  return groups;
}

function trailerEntries(doc: PDFDocument, size: number, previous: number, id: string): string {
  const { Root, Info } = doc.context.trailerInfo;
  const ref = (value: PDFObject | undefined) =>
    value instanceof PDFRef ? `${value.objectNumber} ${value.generationNumber} R` : undefined;
  const root = ref(Root);
  if (!root) {
    refuse('The PDF has no document catalog.', 'unreadable');
  }
  const info = ref(Info);
  return `/Size ${size} /Root ${root}${info ? ` /Info ${info}` : ''}${id} /Prev ${previous}`;
}

/** The file identifier with its first half kept and its second half renewed for this update. */
function identifier(doc: PDFDocument, input: Buffer, signingTime: Date): string {
  const current = arrayOf(doc, doc.context.trailerInfo.ID);
  const first = current?.get(0);
  if (!(first instanceof PDFHexString) && !(first instanceof PDFString)) {
    return '';
  }
  const renewed = createHash('sha256')
    .update(input)
    .update(signingTime.toISOString())
    .digest('hex')
    .slice(0, 32);
  return ` /ID [${first.toString()} <${renewed}>]`;
}

function crossReferenceTable(written: Written[], trailer: string, at: number): Buffer {
  let table = 'xref\n';
  for (const group of runs(written)) {
    table += `${group[0]!.ref.objectNumber} ${group.length}\n`;
    for (const entry of group) {
      const offset = String(entry.offset).padStart(10, '0');
      const generation = String(entry.ref.generationNumber).padStart(5, '0');
      table += `${offset} ${generation} n \n`;
    }
  }
  return latin1(`${table}trailer\n<< ${trailer} >>\nstartxref\n${at}\n%%EOF\n`);
}

function crossReferenceStream(written: Written[], trailer: string, at: number): Buffer {
  const index = runs(written)
    .map((group) => `${group[0]!.ref.objectNumber} ${group.length}`)
    .join(' ');
  const data = Buffer.alloc(written.length * 7);
  written.forEach((entry, position) => {
    const base = position * 7;
    data.writeUInt8(1, base);
    data.writeUInt32BE(entry.offset, base + 1);
    data.writeUInt16BE(entry.ref.generationNumber, base + 5);
  });
  const own = written[written.length - 1]!.ref;
  return Buffer.concat([
    latin1(
      `${own.objectNumber} 0 obj\n<< /Type /XRef /W [1 4 2] /Index [${index}] ${trailer} ` +
        `/Length ${data.length} >>\nstream\n`,
    ),
    data,
    latin1(`\nendstream\nendobj\nstartxref\n${at}\n%%EOF\n`),
  ]);
}

/**
 * Seals a PDF that already carries digital signatures, such as an Aadhaar eSign applied by an
 * eSign provider, without changing any of its bytes. The seal is an approval signature
 * (ETSI.CAdES.detached, SHA-256, RSA; with a timestamp when `tsaUrl` is set) in an invisible
 * field, written as one incremental update after the existing file. Adding a signature is a
 * change earlier signatures permit, so they stay valid and the seal covers them.
 *
 * The output starts with the input, byte for byte. Refuses a file without signatures
 * (`VALIDATION`; use `seal()`), an encrypted or unreadable file (`DOCUMENT_INVALID`), and a
 * file whose signatures forbid another one, which is a certification with no changes allowed
 * or a field lock (`PDF_ALREADY_SIGNED` with `details.reason` `locked`). `certify` is ignored:
 * only the first signature of a file can certify it.
 */
export async function countersign(pdfBytes: Uint8Array, options: SealOptions): Promise<Uint8Array> {
  const signingTime = options.signingTime ?? new Date();
  const signer = sealProvider(options);
  const chainDer = (await signer.certificateChain()).map((der) =>
    Buffer.from(der).toString('binary'),
  );
  const chain = chainDer.map(parseCertificate);
  assertSealChain(chain, signingTime, options.allowWeakKey ?? false);

  const input = Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength);
  const doc = await loadPdf(pdfBytes, { maxBytes: options.maxBytes });
  if (signatureFieldsOf(doc).length === 0) {
    throw new SignError(
      'VALIDATION',
      'The PDF carries no digital signature. Use seal() for a file that is not signed yet.',
      { step: 'countersign' },
    );
  }
  const section = lastSection(input);
  const { context } = doc;
  const catalogRef = context.trailerInfo.Root;
  const formEntry = doc.catalog.get(name('AcroForm'));
  const form = dictOf(doc, formEntry);
  const fieldsEntry = form?.get(name('Fields'));
  const fields = arrayOf(doc, fieldsEntry);
  if (!(catalogRef instanceof PDFRef) || !form || !fields) {
    return refuse('The PDF has no readable form.', 'unreadable');
  }
  assertOpenForSigning(doc, form);

  const timestamp = timestamper(options);
  const signatureLength = placeholderSize(chainDer, timestamp !== undefined);
  const commonName = chain[0]!.subject.getField('CN') as { value?: string } | null;
  const page = doc.getPages()[0]!;

  let next = Math.max(context.largestObjectNumber, declaredSize(input) - 1);
  const allocate = () => PDFRef.of((next += 1));
  const signatureRef = allocate();
  const appearanceRef = allocate();
  const widgetRef = allocate();

  const signature = context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: SUBFILTER_ETSI_CADES_DETACHED,
    ByteRange: PDFName.of(BYTE_RANGE_SLOT.slice(1)),
    Contents: PDFHexString.of('0'.repeat(signatureLength * 2)),
    Reason: text(options.reason ?? DEFAULT_REASON),
    M: PDFString.fromDate(signingTime),
    ContactInfo: text(options.contactInfo ?? ''),
    Name: text(commonName?.value ?? ''),
    Location: text(options.location ?? ''),
    Prop_Build: { Filter: { Name: 'Adobe.PPKLite' } },
  });
  const widget = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [0, 0, 0, 0],
    V: signatureRef,
    T: PDFString.of(uniqueFieldName(doc, fields)),
    F: ANNOTATION_PRINT_LOCKED,
    P: page.ref,
    AP: { N: appearanceRef },
  });
  const appearance = context.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} });

  // Each changed object is written again whole; which one that is depends on whether the
  // file keeps the array or dictionary inline or as an object of its own.
  const changed = new Map<PDFRef, PDFObject>();
  fields.push(widgetRef);
  const formOwner = formEntry instanceof PDFRef ? formEntry : catalogRef;
  const formOwnerObject = formEntry instanceof PDFRef ? form : doc.catalog;
  if (fieldsEntry instanceof PDFRef) {
    changed.set(fieldsEntry, fields);
  } else {
    changed.set(formOwner, formOwnerObject);
  }
  if (numberOf(doc, form.get(name('SigFlags'))) !== SIG_FLAGS) {
    form.set(name('SigFlags'), PDFNumber.of(SIG_FLAGS));
    changed.set(formOwner, formOwnerObject);
  }
  const annotsEntry = page.node.get(name('Annots'));
  const annots = arrayOf(doc, annotsEntry);
  if (annotsEntry instanceof PDFRef && annots) {
    annots.push(widgetRef);
    changed.set(annotsEntry, annots);
  } else {
    const list = annots ?? context.obj([]);
    list.push(widgetRef);
    page.node.set(name('Annots'), list);
    changed.set(page.ref, page.node);
  }

  const objects: [PDFRef, PDFObject][] = [
    ...[...changed].sort(([a], [b]) => a.objectNumber - b.objectNumber),
    [signatureRef, signature],
    [appearanceRef, appearance],
    [widgetRef, widget],
  ];
  const endsWithNewline = input[input.length - 1] === 0x0a || input[input.length - 1] === 0x0d;
  const parts: Buffer[] = [input, latin1(endsWithNewline ? '' : '\n')];
  let offset = input.length + parts[1]!.length;
  const written: Written[] = [];
  let signatureOffset = 0;
  for (const [ref, object] of objects) {
    const bytes = serialise(ref, object);
    if (ref === signatureRef) {
      signatureOffset = offset;
    }
    written.push({ ref, offset });
    parts.push(bytes);
    offset += bytes.length;
  }
  written.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);

  const id = identifier(doc, input, signingTime);
  if (section.stream) {
    written.push({ ref: allocate(), offset });
    parts.push(
      crossReferenceStream(written, trailerEntries(doc, next + 1, section.offset, id), offset),
    );
  } else {
    parts.push(
      crossReferenceTable(written, trailerEntries(doc, next + 1, section.offset, id), offset),
    );
  }
  const output = Buffer.concat(parts);

  const slot = output.indexOf(BYTE_RANGE_SLOT, signatureOffset, 'latin1');
  const contentsStart = output.indexOf('/Contents <', slot, 'latin1') + '/Contents '.length;
  const contentsEnd = contentsStart + signatureLength * 2 + 2;
  if (slot < 0 || output[contentsStart] !== 0x3c || output[contentsEnd - 1] !== 0x3e) {
    throw new SignError('SEAL_FAILED', 'The PDF could not be sealed.', { step: 'countersign' });
  }
  const byteRange = `[0 ${contentsStart} ${contentsEnd} ${output.length - contentsEnd}]`;
  output.write(byteRange.padEnd(BYTE_RANGE_SLOT.length, ' '), slot, 'latin1');

  try {
    const cms = await buildCadesSignature(
      Buffer.concat([output.subarray(0, contentsStart), output.subarray(contentsEnd)]),
      {
        chain,
        chainDer,
        sign: (data) => signer.sign(data),
        ...(timestamp ? { timestamp } : {}),
      },
    );
    if (cms.length > signatureLength) {
      throw new SignError('SEAL_FAILED', 'The signature is larger than the space kept for it.', {
        step: 'countersign',
      });
    }
    output.write(cms.toString('hex'), contentsStart + 1, 'latin1');
  } catch (error) {
    if (error instanceof SignError) {
      throw error;
    }
    throw new SignError('SEAL_FAILED', 'The PDF could not be sealed.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return new Uint8Array(output);
}
