import { describe, expect, it } from 'vitest';
import { fieldsFromTags, findTags } from './tags';

describe('field tags', () => {
  const item = (str: string, x = 100, y = 700, width = str.length * 6) => ({
    str,
    x,
    y,
    width,
    height: 12,
  });

  it('finds every tag, its type, recipient number and position', () => {
    const tags = findTags(
      [
        item('Signed: {{signature:1}}  Date: {{date:1}}'),
        item('{{initials:2}}', 400, 760),
        item('{{ Text : 3 }} {{name:1}} {{checkbox:2}}', 50, 100),
        item('no tags here {{unknown:1}} {{signature:0}}'),
      ],
      4,
    );
    expect(tags.map((t) => [t.type, t.recipient, t.page])).toEqual([
      ['signature', 1, 4],
      ['date_signed', 1, 4],
      ['initials', 2, 4],
      ['text', 3, 4],
      ['name', 1, 4],
      ['checkbox', 2, 4],
    ]);
    expect(tags[0]!.rect).toEqual({ x: 100 + 6 * 8, y: 700, width: 6 * 15, height: 12 });
    expect(tags[2]!.rect.x).toBe(400);
  });

  it('places fields over the tags for the recipient in that signing position', () => {
    const tags = findTags(
      [item('{{signature:1}}'), item('{{initials:2}}', 560, 780), item('{{text:3}}')],
      0,
    );
    let n = 0;
    const { fields, unmatched } = fieldsFromTags(tags, {
      documentId: 'doc',
      recipients: [{ id: 'asha' }, { id: 'ravi' }],
      pageSizes: [{ width: 612, height: 792 }],
      createId: () => `t${++n}`,
    });
    expect(fields.map((f) => [f.type, f.recipientId, f.page])).toEqual([
      ['signature', 'asha', 0],
      ['initials', 'ravi', 0],
    ]);
    expect(fields[0]!.rect).toMatchObject({ x: 100, width: 180, height: 54 });
    expect(fields[1]!.rect.x + fields[1]!.rect.width).toBeLessThanOrEqual(612);
    expect(unmatched.map((t) => t.recipient)).toEqual([3]);
  });
});
