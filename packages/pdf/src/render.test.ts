import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SignError, type Field, type FieldValue } from '@codevibe_technology/sign-core';
import { extractText } from './testing/extract';
import { renderFields } from './render';
import {
  A4,
  field,
  makePdf,
  numbers,
  pageContent,
  pngBase64,
  recipient,
  shownText,
  type PageSpec,
} from './testing/fixtures';

const signer = recipient();

/** Renders one page. Signature captions are off so image placement can be checked exactly. */
async function render(
  page: PageSpec,
  fields: Field[],
  values: FieldValue[],
  options: Parameters<typeof renderFields>[4] = {},
): Promise<string> {
  const output = await renderFields(
    await makePdf([{ blank: true, ...page }]),
    fields,
    values,
    [signer],
    { signatureCaption: false, ...options },
  );
  return pageContent(output, 0);
}

/** Translation and scale of the first image drawn: [x, y, width, height]. */
function imagePlacement(content: string): number[] {
  const match =
    /1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+(?:[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ 0 0 cm\s+)?([\d.-]+) 0 0 ([\d.-]+) 0 0 cm[\s\S]*?Do/.exec(
      content,
    );
  expect(match, content).not.toBeNull();
  return numbers(match!.slice(1, 5).join(' '));
}

/** Matrix of the first text drawn: [a, b, c, d, x, y]. */
function textMatrix(content: string): number[] {
  const match = /([\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+) Tm/.exec(content);
  expect(match, content).not.toBeNull();
  return numbers(match![1]!);
}

async function rejection(promise: Promise<unknown>): Promise<SignError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignError);
  return error as SignError;
}

describe('renderFields: signature caption', () => {
  const draw = async (
    rect: Field['rect'],
    options: Parameters<typeof renderFields>[4] = {},
    who = signer,
    type: Field['type'] = 'signature',
  ) =>
    pageContent(
      await renderFields(
        await makePdf([{ blank: true, size: A4 }]),
        [field(type, { rect })],
        [{ fieldId: `f-${type}`, value: pngBase64(400, 100) }],
        [who],
        options,
      ),
      0,
    );

  it('prints the signer name and signing time under the signature', async () => {
    const content = await draw({ x: 50, y: 50, width: 200, height: 60 });
    expect(shownText(content)).toEqual(['Shubh Kumar, 19 Nov 2026 10:15 UTC']);
    const [x, y, width, height] = imagePlacement(content);
    const strip = 7 * 1.2;
    expect(height).toBeCloseTo(Math.min(50, 60 - strip));
    expect(y).toBeGreaterThan(841.89 - 110 + strip - 0.01);
    expect(x! + width!).toBeLessThanOrEqual(250);
    const [, , , , textX, textY] = textMatrix(content);
    expect(textX).toBeGreaterThanOrEqual(50);
    expect(textY).toBeGreaterThan(841.89 - 110);
    expect(textY).toBeLessThan(841.89 - 110 + strip);
  });

  it('shows the time in the given time zone', async () => {
    const content = await draw(
      { x: 50, y: 50, width: 200, height: 60 },
      { timeZone: 'Asia/Kolkata' },
    );
    expect(shownText(content)).toEqual(['Shubh Kumar, 19 Nov 2026 15:45 GMT+5:30']);
  });

  it('shrinks the caption to fit a narrow box and keeps it on one line', async () => {
    const content = await draw({ x: 50, y: 50, width: 70, height: 40 });
    const shown = shownText(content);
    expect(shown).toHaveLength(1);
    const size = Number(/\/\S+ ([\d.]+) Tf/.exec(content)![1]);
    expect(size).toBeLessThan(7);
    expect(size).toBeGreaterThanOrEqual(3);
  });

  it('prints the name alone when the signing time is not known', async () => {
    const content = await draw(
      { x: 50, y: 50, width: 200, height: 60 },
      {},
      {
        ...signer,
        actedAt: undefined,
      },
    );
    expect(shownText(content)).toEqual(['Shubh Kumar']);
  });

  it('leaves initials, small boxes and opted out renders without a caption', async () => {
    const rect = { x: 50, y: 50, width: 200, height: 60 };
    expect(shownText(await draw(rect, {}, signer, 'initials'))).toEqual([]);
    expect(shownText(await draw({ ...rect, height: 18 }))).toEqual([]);
    expect(shownText(await draw(rect, { signatureCaption: false }))).toEqual([]);
  });
});

describe('renderFields: images', () => {
  it('places a signature at the top-left based rect on a portrait page', async () => {
    const content = await render(
      { size: A4 },
      [field('signature')],
      [{ fieldId: 'f-signature', value: pngBase64(400, 100) }],
    );
    const [x, y, width, height] = imagePlacement(content);
    expect(x).toBeCloseTo(50);
    expect(y).toBeCloseTo(841.89 - 100 - 50);
    expect(width).toBeCloseTo(200);
    expect(height).toBeCloseTo(50);
  });

  it('keeps the aspect ratio and centres a square image in a wide box', async () => {
    const content = await render(
      { size: A4 },
      [field('initials')],
      [{ fieldId: 'f-initials', value: pngBase64(60, 60) }],
    );
    const [x, y, width, height] = imagePlacement(content);
    expect(width).toBeCloseTo(50);
    expect(height).toBeCloseTo(50);
    expect(x).toBeCloseTo(50 + 75);
    expect(y).toBeCloseTo(691.89);
  });

  it('fits a wide image into a tall box', async () => {
    const content = await render(
      { size: A4 },
      [field('signature', { rect: { x: 10, y: 10, width: 100, height: 100 } })],
      [{ fieldId: 'f-signature', value: `data:image/png;base64,${pngBase64(200, 50)}` }],
    );
    const [x, y, width, height] = imagePlacement(content);
    expect(width).toBeCloseTo(100);
    expect(height).toBeCloseTo(25);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(841.89 - 110 + 37.5);
  });

  it('maps coordinates on a landscape page', async () => {
    const content = await render(
      { size: [842, 595] },
      [field('signature', { rect: { x: 600, y: 500, width: 200, height: 50 } })],
      [{ fieldId: 'f-signature', value: pngBase64(400, 100) }],
    );
    const [x, y] = imagePlacement(content);
    expect(x).toBeCloseTo(600);
    expect(y).toBeCloseTo(595 - 550);
  });

  it.each([
    // Rect { x: 100, y: 50, width: 200, height: 50 } on an A4 page shown sideways (841.89 x 595.28).
    { rotation: 90, origin: [100, 100], cos: 0, sin: 1 },
    { rotation: 180, origin: [595.28 - 100, 100], cos: -1, sin: 0 },
    { rotation: 270, origin: [595.28 - 100, 841.89 - 100], cos: 0, sin: -1 },
  ])(
    'draws upright on a page rotated $rotation degrees',
    async ({ rotation, origin, cos, sin }) => {
      const rect = { x: 100, y: 50, width: 200, height: 50 };
      const content = await render(
        { size: A4, rotation },
        [field('signature', { rect })],
        [{ fieldId: 'f-signature', value: pngBase64(400, 100) }],
      );
      const translate = /1 0 0 1 ([\d.-]+) ([\d.-]+) cm/.exec(content);
      const rotate = /([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) 0 0 cm/.exec(
        content.slice(translate!.index + 10),
      );
      const [x, y] = numbers(`${translate![1]} ${translate![2]}`);
      expect(x).toBeCloseTo(origin[0]!);
      expect(y).toBeCloseTo(origin[1]!);
      const [a, b] = numbers(`${rotate![1]} ${rotate![2]}`);
      expect(a).toBeCloseTo(cos);
      expect(b).toBeCloseTo(sin);
    },
  );

  it('accounts for a crop box offset', async () => {
    const content = await render(
      { size: A4, cropBox: [20, 30, 500, 700] },
      [field('signature', { rect: { x: 0, y: 0, width: 100, height: 25 } })],
      [{ fieldId: 'f-signature', value: pngBase64(400, 100) }],
    );
    const [x, y] = imagePlacement(content);
    expect(x).toBeCloseTo(20);
    expect(y).toBeCloseTo(30 + 700 - 25);
  });

  it('rejects images that are not PNG, too large or not base64', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const jpegLike = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
    const cases = [jpegLike, '***', pngBase64(400, 400)];
    const codes = await Promise.all(
      cases.map(
        async (value) =>
          (
            await rejection(
              renderFields(
                pdf,
                [field('signature')],
                [{ fieldId: 'f-signature', value }],
                [signer],
                {
                  maxImageBytes: 1000,
                },
              ),
            )
          ).code,
      ),
    );
    expect(codes).toEqual(['INVALID_FIELD_VALUE', 'INVALID_FIELD_VALUE', 'INVALID_FIELD_VALUE']);
  });
});

describe('renderFields: text', () => {
  it('draws text inside the box, converted to bottom-left coordinates', async () => {
    const content = await render(
      { size: A4 },
      [field('text', { rect: { x: 50, y: 100, width: 200, height: 20 } })],
      [{ fieldId: 'f-text', value: 'Bengaluru' }],
    );
    expect(shownText(content)).toEqual(['Bengaluru']);
    const [a, b, , , x, y] = textMatrix(content);
    expect([a, b]).toEqual([1, 0]);
    expect(x).toBeCloseTo(52);
    expect(y).toBeGreaterThan(841.89 - 120);
    expect(y).toBeLessThan(841.89 - 100);
  });

  it('rotates text with the page so it reads upright', async () => {
    const content = await render(
      { size: A4, rotation: 90 },
      [field('text', { rect: { x: 100, y: 50, width: 200, height: 20 } })],
      [{ fieldId: 'f-text', value: 'Bengaluru' }],
    );
    const [a, b, c, d, x, y] = textMatrix(content);
    expect([a, b, c, d].map((value) => Math.round(value ?? Number.NaN))).toEqual([0, 1, -1, 0]);
    expect(y).toBeCloseTo(102);
    expect(x).toBeGreaterThan(50);
    expect(x).toBeLessThan(70);
  });

  it('shrinks and wraps long text so it stays inside the box', async () => {
    const long = 'I confirm that the information I have provided is complete and correct. '.repeat(
      3,
    );
    const content = await render(
      { size: A4 },
      [field('text', { rect: { x: 50, y: 100, width: 150, height: 60 } })],
      [{ fieldId: 'f-text', value: long }],
    );
    const lines = shownText(content);
    expect(lines.length).toBeGreaterThan(1);
    const sizes = [...content.matchAll(/([\d.]+) Tf/g)].map((match) => Number(match[1]));
    expect(Math.max(...sizes)).toBeLessThan(14);
    const ys = [...content.matchAll(/[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) Tm/g)].map(
      (m) => Number(m[1]),
    );
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(841.89 - 160);
      expect(y).toBeLessThanOrEqual(841.89 - 100);
    }
  });

  it("falls back to the recipient's name and signing time", async () => {
    const content = await render(
      { size: A4 },
      [
        field('name', { rect: { x: 50, y: 100, width: 200, height: 20 } }),
        field('date_signed', { rect: { x: 50, y: 200, width: 200, height: 20 } }),
      ],
      [],
    );
    expect(shownText(content)).toEqual(['Shubh Kumar', '19 Nov 2026']);
  });

  it('formats dates in the given time zone or with a custom formatter', async () => {
    const values = [{ fieldId: 'f-date_signed', value: '2026-11-19T20:00:00.000Z' }];
    const inIndia = await render({ size: A4 }, [field('date_signed')], values, {
      timeZone: 'Asia/Kolkata',
    });
    expect(shownText(inIndia)).toEqual(['20 Nov 2026']);
    const custom = await render({ size: A4 }, [field('date_signed')], values, {
      formatDate: (value) => value.slice(0, 10),
    });
    expect(shownText(custom)).toEqual(['2026-11-19']);
  });

  it('draws text outside Latin script with the bundled fonts', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const output = await renderFields(
      pdf,
      [field('name')],
      [{ fieldId: 'f-name', value: 'शुभ कुमार' }],
      [signer],
    );
    expect((await extractText(output)).join(' ')).toContain('शुभ कुमार');
  });

  it('replaces characters no font covers instead of failing', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const output = await renderFields(
      pdf,
      [field('name')],
      [{ fieldId: 'f-name', value: 'Asha 😀' }],
      [signer],
    );
    expect(shownText(await pageContent(output, 0))).toContain('Asha ?');
  });

  const unicodeFont = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
  it.skipIf(!existsSync(unicodeFont))('draws non-Latin names with a custom font', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const font = new Uint8Array(await readFile(unicodeFont));
    const output = await renderFields(
      pdf,
      [field('name')],
      [{ fieldId: 'f-name', value: 'शुभ कुमार' }],
      [signer],
      {
        font,
      },
    );
    expect((await extractText(output)).join(' ')).toContain('शुभ कुमार');
  });
});

describe('renderFields: checkboxes', () => {
  it('draws a box, with a tick only when checked', async () => {
    const box = { x: 50, y: 100, width: 12, height: 12 };
    const checked = await render(
      { size: A4 },
      [field('checkbox', { rect: box })],
      [{ fieldId: 'f-checkbox', value: 'true' }],
    );
    const unchecked = await render(
      { size: A4 },
      [field('checkbox', { rect: box })],
      [{ fieldId: 'f-checkbox', value: 'false' }],
    );
    const strokes = (content: string) => (content.match(/^S$/gm) ?? []).length;
    expect(strokes(unchecked)).toBe(4);
    expect(strokes(checked)).toBe(6);
  });

  it("rejects values other than 'true' and 'false'", async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const error = await rejection(
      renderFields(pdf, [field('checkbox')], [{ fieldId: 'f-checkbox', value: 'yes' }], [signer]),
    );
    expect(error.code).toBe('INVALID_FIELD_VALUE');
  });
});

describe('renderFields: rules', () => {
  it('requires a value for every required field', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const error = await rejection(
      renderFields(pdf, [field('signature'), field('text', { required: false })], [], [signer]),
    );
    expect(error.code).toBe('REQUIRED_FIELDS_MISSING');
    expect(error.details).toEqual({ fieldIds: ['f-signature'] });
  });

  it('skips optional fields without a value', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const output = await renderFields(pdf, [field('text', { required: false })], [], [signer]);
    expect(shownText(await pageContent(output, 0))).toEqual(['Offer letter']);
  });

  it('draws only the fields of the requested document', async () => {
    const content = await render(
      { size: A4 },
      [field('text', { id: 'a' }), field('text', { id: 'b', documentId: 'd2' })],
      [
        { fieldId: 'a', value: 'mine' },
        { fieldId: 'b', value: 'other' },
      ],
      { documentId: 'd1' },
    );
    expect(shownText(content)).toEqual(['mine']);
  });

  it('rejects fields on missing pages, outside the page or for unknown recipients', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const value = [{ fieldId: 'f-text', value: 'x' }];
    const onPage = await rejection(
      renderFields(pdf, [field('text', { page: 1 })], value, [signer]),
    );
    expect(onPage.code).toBe('VALIDATION');
    expect(onPage.details).toMatchObject({ page: 1, pageCount: 1 });
    const outside = await rejection(
      renderFields(
        pdf,
        [field('text', { rect: { x: 900, y: 10, width: 10, height: 10 } })],
        value,
        [signer],
      ),
    );
    expect(outside.code).toBe('VALIDATION');
    const stranger = await rejection(
      renderFields(pdf, [field('text', { recipientId: 'nobody' })], value, [signer]),
    );
    expect(stranger.code).toBe('RECIPIENT_NOT_FOUND');
  });

  it('keeps a box that runs off the page inside it', async () => {
    const content = await render(
      { size: A4 },
      [field('signature', { rect: { x: 495.28, y: 10, width: 200, height: 25 } })],
      [{ fieldId: 'f-signature', value: pngBase64(400, 100) }],
    );
    const [x = 0, , width = 0] = imagePlacement(content);
    expect(x + width).toBeLessThanOrEqual(595.28 + 0.01);
  });

  it('rejects an unknown time zone', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const error = await rejection(
      renderFields(pdf, [], [], [signer], { timeZone: 'Mars/Olympus' }),
    );
    expect(error.code).toBe('VALIDATION');
  });

  it('leaves existing content and page count alone', async () => {
    const pdf = await makePdf([{ size: A4 }, { size: A4 }]);
    const output = await renderFields(
      pdf,
      [field('text', { page: 1 })],
      [{ fieldId: 'f-text', value: 'x' }],
      [signer],
    );
    expect(shownText(await pageContent(output, 0))).toEqual(['Offer letter']);
    expect(shownText(await pageContent(output, 1))).toEqual(['Offer letter', 'x']);
  });
});

describe('renderFields: Aadhaar eSign box', () => {
  it('draws nothing for the box of an envelope sent while it existed', async () => {
    const plain = await render({ size: A4 }, [], []);
    const boxed = await render({ size: A4 }, [field('aadhaar')], []);
    expect(shownText(boxed)).toEqual(shownText(plain));
  });
});
