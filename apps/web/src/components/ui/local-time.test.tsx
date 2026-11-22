// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalTime } from './local-time';

const ISO = '2026-11-22T18:53:34.000Z';

describe('LocalTime', () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Asia/Kolkata';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('says UTC in the server-rendered HTML, whatever zone the server runs in', () => {
    const html = renderToString(<LocalTime iso={ISO} />);
    expect(html).toContain('22 Nov 2026, 18:53 UTC');
    expect(html).toContain(`dateTime="${ISO}"`);
  });

  it("shows the reader's own time once it runs in their browser", async () => {
    render(<LocalTime iso={ISO} />);
    expect(await screen.findByText('23 Nov 2026, 00:23')).toBeTruthy();
  });

  it('shows only the time for today in the short form, and the day otherwise', async () => {
    const now = new Date('2026-11-22T20:00:00.000Z');
    render(<LocalTime iso={ISO} format="short" now={now} />);
    expect(await screen.findByText('00:23')).toBeTruthy();
    render(<LocalTime iso="2026-11-03T09:12:00.000Z" format="short" now={now} />);
    expect(await screen.findByText('3 Nov, 14:42')).toBeTruthy();
  });
});
