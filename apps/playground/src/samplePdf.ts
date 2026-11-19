/** Builds a small two-page Letter PDF so the demo works without a file to hand. */
export function samplePdf(): Uint8Array {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = (x: number, y: number, size: number, line: string) =>
    `BT /F1 ${size} Tf ${x} ${y} Td (${escape(line)}) Tj ET`;
  const rule = (x: number, y: number, w: number) => `${x} ${y} m ${x + w} ${y} l S`;

  const pages = [
    [
      text(72, 700, 22, 'Offer of employment'),
      text(72, 660, 12, 'Dear candidate,'),
      text(72, 636, 12, 'We are pleased to offer you the role of Product Designer at Example Ltd.'),
      text(72, 618, 12, 'Your start date, salary and benefits are set out on the next page.'),
      text(72, 600, 12, 'Please sign both pages to accept this offer.'),
      text(72, 200, 10, 'Candidate signature'),
      rule(72, 214, 220),
      text(340, 200, 10, 'Date'),
      rule(340, 214, 160),
    ],
    [
      text(72, 700, 18, 'Terms'),
      text(72, 666, 12, '1. Start date: 1 December 2026.'),
      text(72, 648, 12, '2. Annual salary: as discussed, paid monthly.'),
      text(72, 630, 12, '3. Notice period: 30 days on either side.'),
      text(72, 250, 10, 'Approved by the hiring manager'),
      rule(72, 264, 220),
      text(340, 250, 10, 'Candidate initials'),
      rule(340, 264, 100),
    ],
  ];

  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((ops, i) => {
    const pageId = 4 + i * 2;
    const content = ops.join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
