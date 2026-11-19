import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

const cells = (text: string) => parseCsv(text).records.map((r) => r.cells);

describe('parseCsv', () => {
  it('splits plain rows and columns', () => {
    expect(cells('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas, quotes and line breaks inside quoted values', () => {
    const result = parseCsv('name,address\n"Rao, Asha","12 MG Road\nBengaluru"\n"Say ""hi""",x');
    expect(result.records).toEqual([
      { line: 1, cells: ['name', 'address'] },
      { line: 2, cells: ['Rao, Asha', '12 MG Road\nBengaluru'] },
      { line: 4, cells: ['Say "hi"', 'x'] },
    ]);
  });

  it('accepts CRLF, LF and CR line endings', () => {
    expect(cells('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(cells('a,b\r1,2\r3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseCsv('a\r\n"x\r\ny"\r\nz').records.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('drops a leading byte order mark', () => {
    expect(cells('﻿Employee name,Employee email\nAsha,a@x.in')[0]).toEqual([
      'Employee name',
      'Employee email',
    ]);
  });

  it('skips blank lines and lines of empty values but keeps line numbers', () => {
    const result = parseCsv('a,b\n\n1,2\n,\n\r\n3,4\n\n');
    expect(result.records).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 3, cells: ['1', '2'] },
      { line: 6, cells: ['3', '4'] },
    ]);
  });

  it('keeps empty cells and trailing empty columns', () => {
    expect(cells('a,,c,\n')).toEqual([['a', '', 'c', '']]);
    expect(cells('"",x')).toEqual([['', 'x']]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({ records: [] });
    expect(parseCsv('﻿\r\n')).toEqual({ records: [] });
  });

  it('reports a quote that is never closed and keeps earlier records', () => {
    const result = parseCsv('a,b\n1,2\n"open,3\n4,5');
    expect(result.records).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
    ]);
    expect(result.error).toEqual({ line: 3, message: 'A quoted value is never closed' });
  });

  it('treats a quote in the middle of a value as text', () => {
    expect(cells('5" screen,x')).toEqual([['5" screen', 'x']]);
  });

  it('parses 1,000 rows', () => {
    const lines = ['Employee name,Employee email'];
    for (let i = 1; i <= 1000; i++) lines.push(`"Joiner, ${i}",joiner${i}@example.com`);
    const result = parseCsv(lines.join('\r\n'));
    expect(result.records).toHaveLength(1001);
    expect(result.records[1000]).toEqual({
      line: 1001,
      cells: ['Joiner, 1000', 'joiner1000@example.com'],
    });
  });
});
