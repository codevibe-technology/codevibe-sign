import { describe, expect, it } from 'vitest';
import { field } from '../test/fixtures';
import { coveredText, fieldsOverText } from './overlap';

const item = (str: string, x = 100, y = 700, width = str.length * 6) => ({
  str,
  x,
  y,
  width,
  height: 12,
});

describe('text under a field', () => {
  it('finds a line of text the field sits on', () => {
    const clause = item('10. The employee shall give thirty days notice.');
    expect(coveredText({ x: 120, y: 690, width: 160, height: 40 }, [clause])).toEqual([clause]);
  });

  it('leaves text the field only touches at its edge', () => {
    const above = item('Signed for the company', 100, 680);
    const beside = item('Date', 300, 700);
    const rect = { x: 100, y: 690, width: 180, height: 40 };
    expect(coveredText(rect, [above, beside])).toEqual([]);
  });

  it('ignores signature lines, dots and field tags', () => {
    const rect = { x: 100, y: 690, width: 200, height: 40 };
    expect(
      coveredText(rect, [item('____________'), item('. . . . . .'), item('{{signature:1}}')]),
    ).toEqual([]);
  });

  it('passes a field over the blank after a label on the same run', () => {
    const line = item('Signature: ______________________', 100, 700);
    const blank = { x: 100 + 6 * 12, y: 690, width: 6 * 20, height: 40 };
    expect(coveredText(blank, [line])).toEqual([]);
    const overLabel = { x: 100, y: 690, width: 6 * 20, height: 40 };
    expect(coveredText(overLabel, [line])).toEqual([line]);
  });

  it('flags only signature and initials fields, on pages whose text is known', () => {
    const fields = [
      field('sig', 'signature', 'a', { x: 120, y: 690 }),
      field('ini', 'initials', 'a', { x: 120, y: 690, width: 60 }),
      field('txt', 'text', 'a', { x: 120, y: 690 }),
      field('clear', 'signature', 'a', { x: 120, y: 200 }),
      field('unread', 'signature', 'a', { x: 120, y: 690 }, { page: 1 }),
    ];
    const text = [item('10. The employee shall give thirty days notice.')];
    const ids = fieldsOverText(fields, (_doc, page) => (page === 0 ? text : undefined));
    expect([...ids].sort()).toEqual(['ini', 'sig']);
  });
});
