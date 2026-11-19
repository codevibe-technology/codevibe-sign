import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, type PDFObject } from 'pdf-lib';
import { loadPdf, type InspectOptions } from './inspect';

const name = (value: string) => PDFName.of(value);

/** Annotations that carry files, media or scripts rather than marks on the page. */
const ACTIVE_ANNOTATIONS = new Set(
  ['FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D'].map((value) => name(value)),
);

function resolve(doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

/** Only in-document jumps survive; every other action (URI, Launch, JavaScript, …) is dropped. */
function keepsAction(doc: PDFDocument, action: PDFObject | undefined): boolean {
  const dict = resolve(doc, action);
  return (
    dict instanceof PDFDict &&
    resolve(doc, dict.get(name('S'))) === name('GoTo') &&
    !dict.has(name('Next'))
  );
}

function cleanAnnotations(doc: PDFDocument, page: PDFDict): void {
  const annots = resolve(doc, page.get(name('Annots')));
  if (!(annots instanceof PDFArray)) {
    page.delete(name('Annots'));
    return;
  }
  const kept: PDFObject[] = [];
  for (const entry of annots.asArray()) {
    const annotation = resolve(doc, entry);
    if (!(annotation instanceof PDFDict)) {
      continue;
    }
    if (ACTIVE_ANNOTATIONS.has(resolve(doc, annotation.get(name('Subtype'))) as PDFName)) {
      continue;
    }
    annotation.delete(name('AA'));
    // The back-reference to the page would make copying pull in the old page a second time.
    annotation.delete(name('P'));
    if (annotation.has(name('A')) && !keepsAction(doc, annotation.get(name('A')))) {
      annotation.delete(name('A'));
    }
    kept.push(entry);
  }
  page.set(name('Annots'), doc.context.obj(kept));
}

function flattenForm(doc: PDFDocument): void {
  const acroForm = resolve(doc, doc.catalog.get(name('AcroForm')));
  if (!(acroForm instanceof PDFDict)) {
    return;
  }
  // Removed here rather than by pdf-lib, which would print a warning.
  acroForm.delete(name('XFA'));
  doc.catalog.delete(name('NeedsRendering'));
  try {
    doc.getForm().flatten();
  } catch {
    // A form pdf-lib cannot flatten loses its widgets instead; their values are not drawn.
    for (const page of doc.getPages()) {
      const annots = resolve(doc, page.node.get(name('Annots')));
      if (!(annots instanceof PDFArray)) {
        continue;
      }
      const kept = annots.asArray().filter((entry) => {
        const annotation = resolve(doc, entry);
        return !(
          annotation instanceof PDFDict &&
          resolve(doc, annotation.get(name('Subtype'))) === name('Widget')
        );
      });
      page.node.set(name('Annots'), doc.context.obj(kept));
    }
  }
}

/**
 * Returns a new document holding only the pages of `doc`, without anything that acts on its
 * own: document and page open/close actions (/OpenAction, /AA), JavaScript, embedded files,
 * launch and URI actions, file attachment and media annotations, and XFA. Form fields are
 * flattened into the page content first. Catalog-level extras (outlines, structure tree,
 * names) are not carried over, and objects the pages do not use are left behind.
 */
export async function sanitizeDocument(doc: PDFDocument): Promise<PDFDocument> {
  flattenForm(doc);
  for (const page of doc.getPages()) {
    page.node.delete(name('AA'));
    cleanAnnotations(doc, page.node);
  }
  const fresh = await PDFDocument.create({ updateMetadata: false });
  const pages = await fresh.copyPages(doc, doc.getPageIndices());
  for (const page of pages) {
    fresh.addPage(page);
  }
  return fresh;
}

/** Loads `bytes`, removes active content (see `sanitizeDocument`) and writes a fresh file. */
export async function sanitizePdf(
  bytes: Uint8Array,
  options: InspectOptions = {},
): Promise<Uint8Array> {
  const doc = await sanitizeDocument(await loadPdf(bytes, options));
  return doc.save({ useObjectStreams: false });
}
