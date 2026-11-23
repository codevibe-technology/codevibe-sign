#!/usr/bin/env node
// Browser test of the clips on the home page: the hero clip and every step of the pinned story
// must load and play, in Chrome, in Playwright's Chromium and in WebKit (Safari), with no media
// error. It also checks that one key press moves the story exactly one step, that the page does
// not shift as clips load, and the reduced-motion layout, where nothing plays on its own.
//
// It drives an app that is already running in hosted mode (PLAN_MODE=hosted), so `/` is the
// home page, and talks to nothing but that app:
//
//   BASE=http://localhost:3000 node apps/web/e2e/home-clips.mjs
//
// Optional: BROWSERS=chrome,chromium,webkit picks the browsers (all three by default; `chrome`
// is the installed Google Chrome, the one that plays H.264), AXE_PATH points at an axe.min.js
// for the accessibility pass and PLAYWRIGHT_CORE at a playwright-core build that matches the
// installed browsers. Exits non-zero on the first failure.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const playwright = await import(
  process.env.PLAYWRIGHT_CORE
    ? pathToFileURL(require.resolve(process.env.PLAYWRIGHT_CORE)).href
    : 'playwright-core'
);
const { chromium, webkit } = playwright.chromium ? playwright : playwright.default;

const BASE = process.env.BASE ?? 'http://localhost:3000';
const BROWSERS = (process.env.BROWSERS ?? 'chrome,chromium,webkit').split(',').filter(Boolean);
const STEPS = 6;

const axeSource = (() => {
  try {
    return readFileSync(process.env.AXE_PATH ?? require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
})();

const launchers = {
  chrome: () => chromium.launch({ channel: 'chrome', headless: true }),
  chromium: () => chromium.launch({ headless: true }),
  webkit: () => webkit.launch({ headless: true }),
};

function check(condition, message) {
  if (!condition) throw new Error(`Failed: ${message}`);
  console.log(`  ok  ${message}`);
}

/** Opens a page that can reach the app under test and nothing else. */
async function open(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const origin = new URL(BASE).origin;
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__shift = 0;
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (!entry.hadRecentInput) window.__shift += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  return { context, page };
}

/** Every video on the page that has hit a media error, with the file it was playing. */
const mediaErrors = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('video')]
      .filter((video) => video.error)
      .map((video) => `${video.currentSrc} (error ${video.error.code})`),
  );

/**
 * Waits until `video` has data to play from (readyState 3 or more) and its time moves on: a
 * clip that is really playing, not one stuck on its first frame.
 */
async function waitUntilPlaying(page, video, label) {
  const result = await video.evaluate(
    (el) =>
      new Promise((resolve) => {
        const deadline = window.performance.now() + 10_000;
        let from = null;
        const tick = () => {
          if (el.error) return resolve({ error: el.error.code, src: el.currentSrc });
          if (el.readyState >= 3 && !el.paused) {
            if (from === null) from = el.currentTime;
            else if (el.currentTime > from + 0.2)
              return resolve({ readyState: el.readyState, src: el.currentSrc });
          }
          if (window.performance.now() > deadline)
            return resolve({ timeout: true, readyState: el.readyState, paused: el.paused });
          setTimeout(tick, 50);
        };
        tick();
      }),
  );
  check(
    !result.error && !result.timeout,
    `${label} plays (${result.src?.split('/').pop() ?? JSON.stringify(result)})`,
  );
  return result.src;
}

const currentStep = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-story] ol[aria-label="Steps"] button')].findIndex(
      (button) => button.getAttribute('aria-current') === 'step',
    ),
  );

/** The clip on the pinned stage for the step on screen. */
const stageVideo = (page) => page.locator('[data-story] [aria-hidden="false"] video');

async function axe(page, label) {
  if (!axeSource) {
    console.log(`  --  ${label}: accessibility pass skipped, set AXE_PATH to run it`);
    return;
  }
  // Text fading in is checked once it has arrived, not halfway through its transition.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    });
    return result.violations.map((v) => `${v.id}: ${v.nodes.length}`);
  });
  check(violations.length === 0, `${label}: no accessibility violations ${violations.join(', ')}`);
}

async function story(browser, name) {
  const { context, page } = await open(browser);
  try {
    const hero = page.locator('video').first();
    await waitUntilPlaying(page, hero, `${name}: the hero clip`);
    await axe(page, `${name}: home page`);

    // Bring the story to the top of the screen, where its stage pins and the first step sits.
    await page.evaluate(() => {
      const track = document.querySelector('[data-story] .story-track');
      const stage = document.querySelector('[data-story] .story-stage');
      const pinAt = parseFloat(window.getComputedStyle(stage).top) || 0;
      window.scrollTo(0, Math.round(track.getBoundingClientRect().top + window.scrollY - pinAt));
    });
    await page.waitForTimeout(400);
    check((await currentStep(page)) === 0, `${name}: the story starts on its first step`);

    const files = [];
    for (let step = 0; step < STEPS; step++) {
      if (step > 0) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(900);
        check(
          (await currentStep(page)) === step,
          `${name}: one key press moves the story to step ${step + 1}`,
        );
      }
      files.push(await waitUntilPlaying(page, stageVideo(page), `${name}: story step ${step + 1}`));
    }
    const errors = await mediaErrors(page);
    check(
      errors.length === 0,
      `${name}: no clip on the page has a media error ${errors.join(', ')}`,
    );
    const shift = await page.evaluate(() => window.__shift);
    check(shift === 0, `${name}: nothing on the page shifts as the clips load (CLS ${shift})`);
    console.log(`  --  ${name}: played ${files.map((f) => f.split('/').pop()).join(', ')}`);
  } finally {
    await context.close();
  }
}

/** On a phone-sized screen with touch, tapping through the step list plays every clip. */
async function phone(browser, name) {
  const { context, page } = await open(browser, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await page.locator('[data-story]').scrollIntoViewIfNeeded();
    for (let step = 0; step < STEPS; step++) {
      await page.locator('[data-story] ol[aria-label="Steps"] button').nth(step).tap();
      await page.waitForTimeout(700);
      check((await currentStep(page)) === step, `${name}, phone: the story is on step ${step + 1}`);
      await waitUntilPlaying(page, stageVideo(page), `${name}, phone: story step ${step + 1}`);
    }
    const errors = await mediaErrors(page);
    check(errors.length === 0, `${name}, phone: no clip has a media error ${errors.join(', ')}`);
  } finally {
    await context.close();
  }
}

async function reducedMotion(browser, name) {
  const { context, page } = await open(browser, { reducedMotion: 'reduce' });
  try {
    const steps = page.locator('[data-story] .story-step');
    check(
      (await steps.count()) === STEPS,
      `${name}, reduced motion: the steps sit one under another`,
    );
    await steps.nth(1).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const playing = await page.evaluate(
      () => [...document.querySelectorAll('video')].filter((video) => !video.paused).length,
    );
    check(playing === 0, `${name}, reduced motion: no clip starts on its own`);
    const button = steps.nth(1).getByRole('button', { name: /^Play the clip: / });
    await button.click();
    await waitUntilPlaying(
      page,
      steps.nth(1).locator('video'),
      `${name}, reduced motion: step 2 on request`,
    );
    await axe(page, `${name}, reduced motion: home page`);
  } finally {
    await context.close();
  }
}

let failed = false;
for (const name of BROWSERS) {
  const launch = launchers[name];
  if (!launch) throw new Error(`Unknown browser "${name}": use chrome, chromium or webkit.`);
  console.log(`${name}`);
  const browser = await launch();
  try {
    await story(browser, name);
    await phone(browser, name);
    await reducedMotion(browser, name);
  } catch (error) {
    console.error(error.message);
    failed = true;
  } finally {
    await browser.close();
  }
}
process.exit(failed ? 1 : 0);
