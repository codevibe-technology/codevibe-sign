import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inspectPdf } from './inspect';
import { renderFields } from './render';
import { sanitizePdf } from './sanitize';
import { A4, field, makePdf, pageContent, recipient } from './testing/fixtures';

/** A PDF with every kind of active content the sanitizer removes, plus a form field. */
async function hostilePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdf([{ size: A4 }, { size: A4, rotation: 90 }]));
  const { context } = doc;
  const script = context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
  doc.catalog.set(PDFName.of('OpenAction'), context.register(script));
  doc.catalog.set(PDFName.of('AA'), context.obj({ WC: script }));
  const embedded = context.obj({ Type: 'EmbeddedFile' });
  doc.catalog.set(
    PDFName.of('Names'),
    context.obj({
      JavaScript: context.obj({ Names: [PDFString.of('run'), script] }),
      EmbeddedFiles: context.obj({
        Names: [PDFString.of('payload.exe'), context.register(embedded)],
      }),
    }),
  );

  const form = doc.getForm();
  const nameField = form.createTextField('employee.name');
  nameField.setText('Asha Rao');
  nameField.addToPage(doc.getPage(0), { x: 50, y: 700, width: 200, height: 20 });
  const page = doc.getPage(0).node;
  page.set(PDFName.of('AA'), context.obj({ O: script }));
  const annotation = (subtype: string, action?: Record<string, unknown>) =>
    context.register(
      context.obj({
        Type: 'Annot',
        Subtype: subtype,
        Rect: [10, 10, 60, 60],
        ...(action ? { A: context.obj(action as never) } : {}),
      }),
    );
  const existing = page.lookup(PDFName.of('Annots'));
  const annots = [
    ...((existing as { asArray?: () => unknown[] } | undefined)?.asArray?.() ?? []),
    annotation('Link', { S: 'URI', URI: PDFString.of('https://evil.example/') }),
    annotation('Link', { S: 'Launch', F: PDFString.of('calc.exe') }),
    annotation('Link', { S: 'GoTo', D: [doc.getPage(1).ref, 'Fit'] }),
    annotation('FileAttachment'),
  ];
  page.set(PDFName.of('Annots'), context.obj(annots as never));

  // pdf-lib drops XFA whenever its form API is used, so add it to the saved file afterwards.
  const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: false }));
  const acroForm = reloaded.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
  acroForm.set(
    PDFName.of('XFA'),
    reloaded.context.obj([
      PDFString.of('template'),
      reloaded.context.register(reloaded.context.obj({})),
    ]),
  );
  return reloaded.save({ useObjectStreams: false });
}

describe('sanitizePdf', () => {
  it('removes scripts, actions, attachments and XFA, and flattens the form', async () => {
    const original = await hostilePdf();
    const before = Buffer.from(original).toString('latin1');
    for (const marker of [
      '/OpenAction',
      '/JavaScript',
      '/EmbeddedFiles',
      '/URI',
      '/Launch',
      '/XFA',
    ]) {
      expect(before).toContain(marker);
    }

    const output = await sanitizePdf(original);
    const text = Buffer.from(output).toString('latin1');
    for (const marker of [
      '/OpenAction',
      '/AA',
      '/JavaScript',
      '/EmbeddedFiles',
      '/EmbeddedFile',
      '/URI',
      '/Launch',
      '/XFA',
      '/AcroForm',
      '/FileAttachment',
      '/Widget',
      'calc.exe',
      'app.alert',
    ]) {
      expect(text, marker).not.toContain(marker);
    }
    expect(text).toContain('/GoTo');

    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect(await inspectPdf(output)).toEqual(await inspectPdf(original));
  });

  it('keeps the flattened field value on the page', async () => {
    const output = await sanitizePdf(await hostilePdf());
    const doc = await PDFDocument.load(output);
    const page = doc.getPage(0);
    const resources = page.node.Resources();
    expect(resources?.lookup(PDFName.of('XObject'))).toBeDefined();
    expect(await pageContent(output, 0)).toMatch(/Do/);
  });

  it('runs before fields are drawn, so the signed file carries no active content', async () => {
    const rendered = await renderFields(
      await hostilePdf(),
      [field('name', { rect: { x: 50, y: 300, width: 200, height: 30 } })],
      [],
      [recipient()],
    );
    const text = Buffer.from(rendered).toString('latin1');
    expect(text).not.toContain('/JavaScript');
    expect(text).not.toContain('/OpenAction');
    expect(text).not.toContain('/URI');
  });
});
