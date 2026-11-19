export interface CsvRecord {
  /** One-based line on which the record starts. */
  line: number;
  cells: string[];
}

export interface CsvParseResult {
  records: CsvRecord[];
  /** Set when a quoted value is never closed; the records before it are still returned. */
  error?: { line: number; message: string };
}

/**
 * RFC 4180 CSV: comma separated, double quotes around values that hold commas, quotes or line
 * breaks, `""` for a quote inside quotes. Accepts CRLF, LF or CR line endings and a leading
 * byte order mark. Blank lines, and lines of empty values only, are skipped.
 */
export function parseCsv(text: string): CsvParseResult {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c !== '')) records.push({ line: start, cells });
    cells = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n' || (ch === '\r' && input[i + 1] !== '\n')) line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else {
      cell += ch;
    }
  }

  if (quoted) {
    return { records, error: { line: start, message: 'A quoted value is never closed' } };
  }
  endRecord();
  return { records };
}
