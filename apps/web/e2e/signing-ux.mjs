#!/usr/bin/env node
// Browser test of the two screens people sign through: the sender's Fields step and the
// signer's page, on a desktop window and on a 390 px phone, with an accessibility pass on each.
//
// It drives an app that is already running with MAIL_TRANSPORT=console and its output going to
// a log file, where the sign-in link, the signing links and the one-time codes are read from:
//
//   BASE=http://localhost:3000 WEB_LOG=/tmp/web.log node apps/web/e2e/signing-ux.mjs
//
// Optional: SHOTS=<dir> keeps screenshots, CHROME_PATH points at a Chromium to use and
// AXE_PATH at an axe.min.js for the accessibility pass.
// Exits non-zero on the first failure.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts } = require('pdf-lib');

/**
 * The accessibility pass uses axe-core when it can be found: a path to `axe.min.js` in
 * AXE_PATH, or the package if it happens to be installed. It is not a dependency of this
 * repository, so without it the pass is skipped and says so.
 */
function loadAxe() {
  try {
    return readFileSync(process.env.AXE_PATH ?? require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}
const axeSource = loadAxe();

const BASE = process.env.BASE ?? 'http://localhost:3000';
const LOG = process.env.WEB_LOG;
const SHOTS = process.env.SHOTS;
if (!LOG) {
  console.error('Set WEB_LOG to the file the running app writes its output to.');
  process.exit(1);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition, message) {
  if (!condition) throw new Error(`Failed: ${message}`);
  console.log(`  ok  ${message}`);
}

const logSize = () => readFileSync(LOG, 'utf8').length;

/** The newest text matching `pattern` in a mail to `email` written after `offset`. */
async function mail(email, pattern, offset) {
  for (let i = 0; i < 120; i++) {
    const parts = readFileSync(LOG, 'utf8').slice(offset).split('[mail] to=').reverse();
    for (const part of parts) {
      const match = part.startsWith(email) ? pattern.exec(part) : null;
      if (match) return match[0];
    }
    await sleep(250);
  }
  throw new Error(`No mail to ${email} matching ${pattern}`);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** WCAG 2 A and AA violations on the page as it stands. */
async function axe(page, label) {
  if (!axeSource) {
    console.log(`  --  ${label}: accessibility pass skipped, set AXE_PATH to run it`);
    return;
  }
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${n.failureSummary}`),
    }));
  });
  if (violations.length > 0) console.error(JSON.stringify(violations, null, 1));
  check(violations.length === 0, `${label}: no WCAG A or AA violations`);
}

/** A four page agreement with text on every page, so fields have something to sit among. */
async function agreement() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= 4; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText('Services agreement', { x: 56, y: 772, size: 20, font });
    for (let line = 0; line < 14; line++) {
      page.drawText(`${p}.${line + 1} The supplier provides the services with reasonable care.`, {
        x: 56,
        y: 730 - line * 22,
        size: 10.5,
        font,
      });
    }
    page.drawText(`Page ${p} of 4`, { x: 56, y: 36, size: 9, font });
  }
  return Buffer.from(await doc.save());
}

const overlap = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner, outer) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

const run = Date.now().toString(36).slice(-5);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});

try {
  // ── Sender ────────────────────────────────────────────────────────────────────────────
  console.log('Sender: sign in and start an envelope');
  const sender = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await sender.newPage();
  const owner = `owner-${run}@example.com`;
  await p.goto(`${BASE}/sign-in`);
  let offset = logSize();
  await p.getByLabel('Work email').fill(owner);
  await p.getByRole('button', { name: 'Email me a link instead' }).click();
  await p.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await p.getByText('Check your email').waitFor();
  await p.goto(await mail(owner, /https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/, offset));
  await p.getByLabel('Your name').fill('Priya Menon');
  await p.getByLabel('Workspace name').fill(`Kestrel ${run}`);
  await sleep(1200);
  await p.getByRole('button', { name: /create/i }).click();
  await p.waitForURL(/\/dashboard\/[^/]+$/, { timeout: 60_000 });
  const slug = new URL(p.url()).pathname.split('/')[2];

  await p.goto(`${BASE}/dashboard/${slug}/envelopes/new`);
  await p.locator('input[type=file]').waitFor({ state: 'attached' });
  await sleep(2500);
  await p.setInputFiles('input[type=file]', {
    name: 'agreement.pdf',
    mimeType: 'application/pdf',
    buffer: await agreement(),
  });
  const next = async () => {
    await p.getByRole('button', { name: /^continue/i }).click();
    await sleep(1200);
  };
  await p.getByText('agreement.pdf').first().waitFor();
  await sleep(2500);
  await next();
  await p.getByRole('button', { name: /add recipient/i }).waitFor();
  const people = [
    ['Asha Rao', `asha-${run}@example.com`],
    ['Ravi Kumar', `ravi-${run}@example.com`],
  ];
  for (let i = 0; i < people.length; i++) {
    await p.getByRole('button', { name: /add recipient/i }).click();
    await p.getByLabel(/name/i).nth(i).fill(people[i][0]);
    await p.getByLabel(/email/i).nth(i).fill(people[i][1]);
  }
  await next();

  console.log('Sender: place fields');
  await p.locator('[data-cvs-page="0"]').first().waitFor();
  await sleep(1500);
  const viewer = p.locator('.cvs-placer .cvs-scroller');
  const placed = (name) => p.getByRole('button', { name });

  await p.getByRole('button', { name: 'Signature', exact: true }).click();
  const signature = placed(/^Signature for Asha Rao, page 1/);
  await signature.waitFor();
  check(
    inside(await signature.boundingBox(), await viewer.boundingBox()),
    'a field added by a click lands inside the part of the page on screen',
  );
  await p.getByRole('button', { name: 'Date signed', exact: true }).click();
  const date = placed(/^Date signed for Asha Rao, page 1/);
  await date.waitFor();
  check(
    !overlap(await signature.boundingBox(), await date.boundingBox()),
    'the next field added does not land on top of the first',
  );
  check(inside(await date.boundingBox(), await viewer.boundingBox()), 'and is on screen too');

  const pages = p.getByLabel('Show on pages');
  check((await pages.inputValue()) === 'this', 'a new field is on "This page only"');
  check(
    (await pages.locator('option').allInnerTexts()).join('|') ===
      'This page only|All pages|Specific pages…',
    'the pages choice offers this page, all pages and specific pages, and nothing else',
  );
  check(
    (await p.getByRole('button', { name: 'Repeat', exact: true }).count()) === 0,
    'there is no separate Repeat button',
  );
  await shot(p, 's1-fields-this-page-only-1440');

  await p.getByRole('button', { name: 'Initials', exact: true }).click();
  await placed(/^Initials for Asha Rao, page 1/).waitFor();
  await pages.selectOption('all');
  await p.getByText('Added to 3 more pages.').waitFor();
  check(
    (await placed(/^Initials for Asha Rao/).count()) === 4,
    '"All pages" copies the field to every page at once',
  );
  await shot(p, 's2-all-pages-1440');
  await pages.selectOption('custom');
  const numbers = p.getByRole('textbox', { name: 'Page numbers' });
  check(
    (await numbers.inputValue()) === '1-4',
    'the page numbers box starts from the pages the field is on',
  );
  await numbers.fill('3, 9');
  await numbers.press('Enter');
  await p.getByText('This document has 4 pages; 9 is past the end.').waitFor();
  check(
    (await placed(/^Initials for Asha Rao/).count()) === 4,
    'a page that does not exist changes nothing',
  );
  await shot(p, 's3-specific-pages-error-1440');
  await numbers.fill('1, 3');
  await p.getByRole('button', { name: 'Apply', exact: true }).click();
  await p.getByText('Removed from 2 other pages.').waitFor();
  check(
    (await placed(/^Initials for Asha Rao/).count()) === 2,
    '"Specific pages" keeps exactly the pages typed',
  );
  await shot(p, 's4-specific-pages-1440');
  await pages.selectOption('this');
  check(
    (await placed(/^Initials for Asha Rao/).count()) === 1,
    '"This page only" takes the copies away',
  );
  await p.keyboard.press('Escape');

  // Drag from the palette: the ghost is the size of the field that will land.
  const palette = p.getByRole('button', { name: 'Text', exact: true });
  const from = await palette.boundingBox();
  const sheet = await p.locator('[data-cvs-page="0"]').first().boundingBox();
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await p.mouse.down();
  await p.mouse.move(sheet.x + sheet.width * 0.7, sheet.y + 120, { steps: 10 });
  const ghost = await p.locator('.cvs-drag-ghost').boundingBox();
  await shot(p, 's5-drag-ghost-1440');
  await p.mouse.up();
  const text = await placed(/^Text for Asha Rao, page 1/).boundingBox();
  check(
    Math.abs(ghost.width - text.width) < 4 && Math.abs(ghost.height - text.height) < 4,
    'the drag ghost is the size of the field it drops',
  );

  await p.getByRole('radio', { name: 'Ravi Kumar' }).check({ force: true });
  await p.getByRole('button', { name: 'Signature', exact: true }).click();
  await placed(/^Signature for Ravi Kumar, page 1/).waitFor();
  await p.getByRole('button', { name: 'Initials', exact: true }).click();
  await placed(/^Initials for Ravi Kumar, page 1/).waitFor();
  await p.getByLabel('Show on pages').selectOption('all');
  await p.getByText('Added to 3 more pages.').waitFor();
  await shot(p, 's6-two-signers-1440');
  await axe(p, 'Fields step');

  await next();
  offset = logSize();
  await p.getByRole('button', { name: /^send/i }).last().click();
  await p.waitForURL(/\/envelopes\/(?!new)[^/]+$/, { timeout: 30_000 });
  const sent = offset;
  await sender.close();

  // ── Signers ───────────────────────────────────────────────────────────────────────────
  const devices = {
    desktop: { viewport: { width: 1440, height: 900 } },
    phone: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
  };
  for (const [device, who] of [
    ['desktop', 0],
    ['phone', 1],
  ]) {
    const [name, email] = people[who];
    const width = devices[device].viewport.width;
    console.log(`Signer on a ${device} (${width} px): ${name}`);
    const context = await browser.newContext(devices[device]);
    const s = await context.newPage();
    const errors = [];
    s.on('pageerror', (error) => errors.push(String(error)));
    // Signers take turns, so the second link is mailed once the first has signed.
    await s.goto(`${BASE}${await mail(email, /\/api\/sign\/[\w-]{43}/, sent)}`);
    offset = logSize();
    await s
      .getByRole('button', { name: /send|code/i })
      .first()
      .click();
    await s
      .locator('input')
      .first()
      .fill(await mail(email, /\b\d{6}\b/, offset));
    await s.keyboard.press('Enter');
    await s.getByRole('checkbox').first().check();
    await s
      .getByRole('button', { name: /continue/i })
      .last()
      .click();

    const bar = s.getByRole('group', { name: 'Signing progress and actions' });
    await bar.waitFor();
    await s.locator('[data-cvs-page="0"]').first().waitFor();
    await sleep(2000);
    const scroller = s.getByRole('region', { name: 'Document pages' });
    const state = () =>
      s.evaluate(() => {
        const el = document.querySelector('.cvs-scroller');
        const actions = document.querySelector('.cvs-action-bar').getBoundingClientRect();
        const sheet = document.querySelector('[data-cvs-page]').getBoundingClientRect();
        return {
          windowY: Math.round(window.scrollY),
          pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
          pageOverflowY: document.documentElement.scrollHeight - window.innerHeight,
          top: Math.round(el.scrollTop),
          left: Math.round(el.scrollLeft),
          canScrollY: el.scrollHeight - el.clientHeight,
          canScrollX: el.scrollWidth - el.clientWidth,
          viewerLeft: el.getBoundingClientRect().left,
          sheetLeft: sheet.left,
          barBottom: actions.bottom,
          barTop: actions.top,
          windowHeight: window.innerHeight,
        };
      });
    const barOnScreen = (m) => m.barTop >= 0 && m.barBottom <= m.windowHeight + 1;

    let m = await state();
    check(
      m.pageOverflowY <= 0 && m.pageOverflowX <= 0,
      'the page itself does not scroll: the document is the one scrolling area',
    );
    check(m.canScrollY > 500, 'the document scrolls up and down inside its area');
    check(m.canScrollX <= 1, 'fitted to the width, it does not scroll sideways');
    check(barOnScreen(m), 'the bar with Start is on screen before any scrolling');
    await shot(s, `g1-document-${width}`);

    const area = await scroller.boundingBox();
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const cdp = await context.newCDPSession(s);
    const scrollBy = async (dx, dy) => {
      if (device === 'desktop') {
        await s.mouse.move(cx, cy);
        await s.mouse.wheel(dx, dy);
      } else {
        await cdp.send('Input.synthesizeScrollGesture', {
          x: Math.round(cx),
          y: Math.round(cy),
          xDistance: -dx,
          yDistance: -dy,
          speed: 2000,
          gestureSourceType: 'touch',
        });
      }
      await sleep(400);
    };

    await s.getByRole('button', { name: 'Zoom in' }).click();
    await s.getByRole('button', { name: 'Zoom in' }).click();
    await sleep(1200);
    m = await state();
    check(m.canScrollX > 50, 'zoomed to 150% the document is wider than its area');
    check(m.left === 0 && m.sheetLeft >= m.viewerLeft, 'and its left edge can be reached');
    await scrollBy(0, 600);
    m = await state();
    check(m.top > 300, 'zoomed in, a vertical scroll over the document still moves it down');
    check(
      m.windowY === 0 && barOnScreen(m),
      'the page stays put and the action bar stays on screen',
    );
    await scrollBy(200, 0);
    m = await state();
    check(m.left > 50, 'a sideways scroll pans across the zoomed page');
    await shot(s, `g2-zoomed-scrolled-${width}`);
    await s.getByRole('button', { name: 'Fit to width' }).click();
    await sleep(800);

    // Every control in the bar is big enough for a finger.
    const smallest = await bar.evaluate((el) =>
      Math.min(
        ...[...el.querySelectorAll('button')]
          .filter((b) => b.offsetParent)
          .map((b) => b.getBoundingClientRect().height),
      ),
    );
    check(
      smallest >= 44,
      `the buttons in the bar are at least 44 px tall (smallest ${Math.round(smallest)})`,
    );

    await bar.getByRole('button', { name: 'Start', exact: true }).click();
    await sleep(900);
    const current = s.locator('.cvs-field[data-current]');
    check((await current.count()) === 1, 'Start marks the first field to fill');
    check(
      inside(await current.boundingBox(), await scroller.boundingBox()),
      'and brings it on screen',
    );
    check(await s.locator('.cvs-guide-flag').isVisible(), 'with a flag that says what to do there');
    const empty = await s.locator('.cvs-field--sign[data-state="empty"]').first().boundingBox();
    check(
      empty.height >= 36 && empty.width >= 60,
      `an empty signature box is big enough to tap (${Math.round(empty.width)} x ${Math.round(empty.height)})`,
    );
    await shot(s, `g3-started-${width}`);
    await axe(s, `Signing page at ${width}`);

    // Work through the fields with the one guide button: it reads Sign or Initial on a
    // signature box, so the small box on the page never has to be hit, and Next elsewhere.
    let signed = 0;
    for (let i = 0; i < 16; i++) {
      const guide = bar.locator('.cvs-action-guide.cvs-button--primary');
      if ((await guide.count()) === 0) break;
      const label = (await guide.innerText()).trim();
      const typing = s.locator('.cvs-field--text:focus');
      if (label === 'Next' && (await typing.count())) {
        await typing.fill('Pune');
        await shot(s, `g4-typing-${width}`);
        await typing.press('Enter');
        await sleep(700);
        continue;
      }
      await guide.click();
      await sleep(500);
      const dialog = s.getByRole('dialog');
      if ((await dialog.count()) === 0) continue;
      await dialog.getByRole('tab', { name: 'Type' }).click();
      await sleep(700);
      if (signed === 0) {
        await shot(s, `g5-signature-${width}`);
        await axe(s, `Signature dialog at ${width}`);
      }
      await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
      await sleep(900);
      if (signed === 0) {
        const moved =
          (await s.locator('.cvs-field[data-current]:not([data-state="filled"])').count()) === 1 ||
          (await bar.locator('.cvs-action-finish.cvs-button--primary').count()) === 1;
        check(moved, 'after signing, the guide moves on by itself');
        await shot(s, `g6-after-signing-${width}`);
      }
      signed += 1;
    }
    check(signed > 0, 'the guide button opened the signature pad');
    const finish = bar.getByRole('button', { name: /^Finish/ });
    check(await finish.isVisible(), 'with every required field done, Finish is the button left');
    check(
      await finish.evaluate((el) => el.classList.contains('cvs-button--primary')),
      'and it is the main one',
    );
    m = await state();
    check(barOnScreen(m), 'the action bar is still on screen at the end');
    await shot(s, `g7-ready-to-finish-${width}`);
    await finish.click();
    await s.getByTestId('signing-shell').getByRole('heading').first().waitFor();
    await bar.waitFor({ state: 'detached', timeout: 30_000 });
    await shot(s, `g8-done-${width}`);
    check(
      errors.length === 0,
      `no script errors on the signing page${errors.length ? `: ${errors[0]}` : ''}`,
    );
    await context.close();
  }
  console.log('\nSigning UX: all checks passed.');
} finally {
  await browser.close();
}
