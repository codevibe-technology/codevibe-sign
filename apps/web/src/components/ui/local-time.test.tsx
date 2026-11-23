// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalTime, ViewerTimeZone } from './local-time';

const ISO = '2026-11-22T18:53:34.000Z';

/** Runs `check` as if the browser were in `zone`. */
async function inZone(zone: string, check: () => Promise<void> | void) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    await check();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
    cleanup();
  }
}

afterEach(cleanup);

describe('LocalTime', () => {
  it('says UTC in the server-rendered HTML, whatever zone the server runs in', async () => {
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
      await inZone(zone, () => {
        const html = renderToString(<LocalTime iso={ISO} />);
        expect(html).toContain('22 Nov 2026, 18:53 UTC');
        expect(html).toContain(`dateTime="${ISO}"`);
      });
    }
  });

  it("shows the reader's own time and names their zone once it runs in their browser", async () => {
    const seen: Record<string, string> = {
      'Asia/Kolkata': '23 Nov 2026, 00:23 GMT+5:30',
      'America/New_York': '22 Nov 2026, 13:53 GMT-5',
      'Pacific/Auckland': '23 Nov 2026, 07:53 GMT+13',
      'Europe/London': '22 Nov 2026, 18:53 GMT',
      UTC: '22 Nov 2026, 18:53 UTC',
    };
    for (const [zone, text] of Object.entries(seen)) {
      await inZone(zone, async () => {
        render(<LocalTime iso={ISO} />);
        expect(await screen.findByText(text)).toBeTruthy();
      });
    }
  });

  it('follows daylight saving on each side of a change', async () => {
    await inZone('America/New_York', async () => {
      render(<LocalTime iso="2026-03-08T06:59:00.000Z" />);
      render(<LocalTime iso="2026-03-08T07:00:00.000Z" />);
      render(<LocalTime iso="2026-11-01T05:59:00.000Z" />);
      render(<LocalTime iso="2026-11-01T06:00:00.000Z" />);
      expect(await screen.findByText('8 Mar 2026, 01:59 GMT-5')).toBeTruthy();
      expect(await screen.findByText('8 Mar 2026, 03:00 GMT-4')).toBeTruthy();
      expect(await screen.findByText('1 Nov 2026, 01:59 GMT-4')).toBeTruthy();
      expect(await screen.findByText('1 Nov 2026, 01:00 GMT-5')).toBeTruthy();
    });
    await inZone('Europe/London', async () => {
      render(<LocalTime iso="2026-03-29T00:59:00.000Z" />);
      render(<LocalTime iso="2026-03-29T01:00:00.000Z" />);
      expect(await screen.findByText('29 Mar 2026, 00:59 GMT')).toBeTruthy();
      expect(await screen.findByText('29 Mar 2026, 02:00 BST')).toBeTruthy();
    });
  });

  it('puts a moment near midnight on the right day in each zone', async () => {
    const justBeforeMidnightUtc = '2026-12-31T23:59:30.000Z';
    await inZone('Asia/Kolkata', async () => {
      render(<LocalTime iso={justBeforeMidnightUtc} format="day" />);
      expect(await screen.findByText('1 Jan 2027')).toBeTruthy();
    });
    await inZone('America/New_York', async () => {
      render(<LocalTime iso={justBeforeMidnightUtc} format="day" />);
      expect(await screen.findByText('31 Dec 2026')).toBeTruthy();
    });
  });

  it('shows only the time for today in the short form, and the day otherwise', async () => {
    await inZone('Asia/Kolkata', async () => {
      const now = new Date('2026-11-22T20:00:00.000Z');
      render(<LocalTime iso={ISO} format="short" now={now} />);
      expect(await screen.findByText('00:23 GMT+5:30')).toBeTruthy();
      render(<LocalTime iso="2026-11-03T09:12:00.000Z" format="short" now={now} />);
      expect(await screen.findByText('3 Nov, 14:42 GMT+5:30')).toBeTruthy();
    });
  });

  it('names the zone on hover where the text itself is a day or "5 min ago"', async () => {
    await inZone('Asia/Kolkata', async () => {
      const now = new Date('2026-11-22T18:58:34.000Z');
      render(<LocalTime iso={ISO} format="relative" now={now} />);
      const relative = await screen.findByText('5 min ago');
      await screen.findByTitle('23 Nov 2026, 00:23 GMT+5:30');
      expect(relative.getAttribute('datetime')).toBe(ISO);
      render(<LocalTime iso={ISO} format="day" />);
      expect((await screen.findByText('23 Nov 2026')).title).toBe('23 Nov 2026, 00:23 GMT+5:30');
    });
  });

  it('uses the zone someone saved in their settings, on the server and in the browser', async () => {
    await inZone('America/New_York', async () => {
      const tree = (
        <ViewerTimeZone zone="Pacific/Auckland">
          <LocalTime iso={ISO} />
        </ViewerTimeZone>
      );
      expect(renderToString(tree)).toContain('23 Nov 2026, 07:53 GMT+13');
      render(tree);
      expect(await screen.findByText('23 Nov 2026, 07:53 GMT+13')).toBeTruthy();
      expect(screen.queryByText(/GMT-5/)).toBeNull();
    });
  });
});
