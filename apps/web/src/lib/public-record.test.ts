import { describe, expect, it } from 'vitest';
import { isRecordId, parseRecordId, recordPath } from './public-record';

const ID = 'Zk3vQ9xLm2Tn8RbYc4Wd7HsA';

describe('parseRecordId', () => {
  it('reads the id from a link, a scanned link or the bare code', () => {
    expect(parseRecordId(ID)).toBe(ID);
    expect(parseRecordId(`  https://sign.codevibe.in/r/${ID}\n`)).toBe(ID);
    expect(parseRecordId(`https://sign.example.com/r/${ID}/`)).toBe(ID);
    expect(parseRecordId(`https://sign.example.com/r/${ID}?utm=1#top`)).toBe(ID);
    expect(parseRecordId(`sign.example.com/r/${ID}/certificate`)).toBe(ID);
  });

  it('refuses what cannot be a record id', () => {
    for (const input of ['', 'abc', 'https://sign.example.com/verify', `${ID}!`, '../../etc']) {
      expect(parseRecordId(input)).toBeNull();
    }
    expect(parseRecordId('https://sign.example.com/r/short')).toBeNull();
    expect(isRecordId('a'.repeat(65))).toBe(false);
  });

  it('builds the path a record lives at', () => {
    expect(recordPath(ID)).toBe(`/r/${ID}`);
  });
});
