import { rgb, type PDFDocument, type PDFPage, type RGB } from 'pdf-lib';
import type { FontSet } from './fonts';
import type { Face } from './typeset';
import { wrapText } from './text';

export const A4 = { width: 595.28, height: 841.89 };
export const MARGIN = 44;
export const CONTENT_WIDTH = A4.width - MARGIN * 2;
const FOOTER_SPACE = 30;
const LABEL_WIDTH = 96;
const CELL_PADDING = 5;

export const COLORS = {
  text: rgb(0.1, 0.11, 0.15),
  muted: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.85, 0.87, 0.9),
  band: rgb(0.96, 0.97, 0.98),
  link: rgb(0.11, 0.42, 0.88),
};

const SIZE = { title: 18, continued: 12, section: 10.5, strong: 9.5, body: 9, label: 8, small: 7 };
export const LEADING = 1.35;

export interface TextStyle {
  font: Face;
  size: number;
  color: RGB;
}

export type StyleName = 'body' | 'strong' | 'label' | 'small' | 'mono' | 'monoSmall' | 'link';

/** Text to wrap into a column, in one style. */
export interface Part {
  text: string;
  style: TextStyle;
}

export interface Column {
  title: string;
  width: number;
}

/** Where something was drawn, in page coordinates. */
export interface Box {
  page: PDFPage;
  x: number;
  top: number;
  bottom: number;
  width: number;
}

/**
 * Writes A4 pages from the top down and starts a new page, with the title repeated, when the
 * next piece does not fit.
 */
export class PageFlow {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: FontSet,
    private readonly title: string,
  ) {}

  style(name: StyleName): TextStyle {
    const { regular, bold, mono } = this.fonts;
    switch (name) {
      case 'body':
        return { font: regular, size: SIZE.body, color: COLORS.text };
      case 'strong':
        return { font: bold, size: SIZE.strong, color: COLORS.text };
      case 'label':
        return { font: regular, size: SIZE.label, color: COLORS.muted };
      case 'small':
        return { font: regular, size: SIZE.small, color: COLORS.muted };
      case 'mono':
        return { font: mono, size: SIZE.label, color: COLORS.text };
      case 'monoSmall':
        return { font: mono, size: SIZE.small, color: COLORS.muted };
      case 'link':
        return { font: mono, size: SIZE.label, color: COLORS.link };
    }
  }

  newPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = A4.height - MARGIN;
    const continued = this.pages.length > 1;
    const size = continued ? SIZE.continued : SIZE.title;
    this.write(continued ? `${this.title} (continued)` : this.title, MARGIN, {
      font: this.fonts.bold,
      size,
      color: COLORS.text,
    });
    this.y -= size * 1.45;
    this.rule();
    this.y -= 12;
  }

  private write(text: string, x: number, style: TextStyle, y = this.y): void {
    style.font.draw(this.page, text, {
      x,
      y: y - style.size,
      size: style.size,
      color: style.color,
    });
  }

  rule(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4.width - MARGIN, y: this.y },
      thickness: 0.75,
      color: COLORS.rule,
    });
  }

  /** Starts a new page when fewer than `height` points are left. */
  ensure(height: number): void {
    if (this.y - height < MARGIN + FOOTER_SPACE) {
      this.newPage();
    }
  }

  gap(points: number): void {
    this.y -= points;
  }

  private wrap(parts: Part[], width: number): Part[] {
    return parts.flatMap((part) =>
      wrapText(part.text, part.style.font, part.style.size, width).map((text) => ({
        text,
        style: part.style,
      })),
    );
  }

  paragraph(text: string, style: TextStyle, width = CONTENT_WIDTH): void {
    for (const line of this.wrap([{ text, style }], width)) {
      this.ensure(style.size * LEADING);
      this.write(line.text, MARGIN, style);
      this.y -= style.size * LEADING;
    }
  }

  section(title: string, keepWith = 0): void {
    this.ensure(SIZE.section * LEADING + 14 + keepWith);
    this.y -= 8;
    this.write(title, MARGIN, { font: this.fonts.bold, size: SIZE.section, color: COLORS.text });
    this.y -= SIZE.section * LEADING + 4;
  }

  /**
   * A label on the left and its value beside it, wrapped to `width` points from the left
   * margin. Returns where the value was drawn.
   */
  field(label: string, parts: Part[], width = CONTENT_WIDTH): Box {
    const labelStyle = this.style('label');
    const lines = this.wrap(parts, width - LABEL_WIDTH);
    const first = lines[0]?.style.size ?? labelStyle.size;
    this.ensure(Math.max(first, labelStyle.size) * LEADING);
    this.write(label, MARGIN, labelStyle, this.y - Math.max(0, first - labelStyle.size) * 0.8);
    const box: Box = {
      page: this.page,
      x: MARGIN + LABEL_WIDTH,
      top: this.y,
      bottom: this.y,
      width: width - LABEL_WIDTH,
    };
    for (const line of lines) {
      const height = line.style.size * LEADING;
      if (this.y - height < MARGIN + FOOTER_SPACE) {
        this.newPage();
        box.page = this.page;
        box.top = this.y;
      }
      this.write(line.text, MARGIN + LABEL_WIDTH, line.style);
      this.y -= height;
    }
    box.bottom = this.y;
    this.y -= 4;
    return box;
  }

  /** A table whose header repeats on every page it spans. Each cell is a stack of parts. */
  table(columns: Column[], rows: Part[][][]): void {
    const headerStyle: TextStyle = { font: this.fonts.bold, size: SIZE.label, color: COLORS.muted };
    const headerHeight = headerStyle.size * LEADING + CELL_PADDING * 2;

    const header = () => {
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - headerHeight,
        width: CONTENT_WIDTH,
        height: headerHeight,
        color: COLORS.band,
      });
      let x = MARGIN + CELL_PADDING;
      for (const column of columns) {
        this.write(column.title, x, headerStyle, this.y - CELL_PADDING);
        x += column.width;
      }
      this.y -= headerHeight;
    };

    const wrapped = rows.map((row) =>
      row.map((cell, index) => this.wrap(cell, (columns[index]?.width ?? 0) - CELL_PADDING * 2)),
    );
    const heightOf = (cells: Part[][]) =>
      Math.max(
        ...cells.map((cell) => cell.reduce((sum, line) => sum + line.style.size * LEADING, 0)),
      ) +
      CELL_PADDING * 2;

    this.ensure(headerHeight + (wrapped[0] ? heightOf(wrapped[0]) : 0));
    header();
    for (const cells of wrapped) {
      const height = heightOf(cells);
      if (this.y - height < MARGIN + FOOTER_SPACE) {
        this.newPage();
        header();
      }
      let x = MARGIN + CELL_PADDING;
      cells.forEach((cell, index) => {
        let y = this.y - CELL_PADDING;
        for (const line of cell) {
          this.write(line.text, x, line.style, y);
          y -= line.style.size * LEADING;
        }
        x += columns[index]?.width ?? 0;
      });
      this.y -= height;
      this.rule();
    }
  }

  /** The envelope on the left and the page number on the right, at the foot of every page. */
  footers(left: string, generatedAt: string): void {
    const style = this.style('small');
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const right = `Page ${index + 1} of ${total}  ·  Generated ${generatedAt}`;
      const rightWidth = style.font.widthOfTextAtSize(right, style.size);
      const y = MARGIN - 12;
      style.font.draw(page, left, { x: MARGIN, y, size: style.size, color: style.color });
      style.font.draw(page, right, {
        x: A4.width - MARGIN - rightWidth,
        y,
        size: style.size,
        color: style.color,
      });
    });
  }
}
