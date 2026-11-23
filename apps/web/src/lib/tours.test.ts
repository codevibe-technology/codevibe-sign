import { describe, expect, it } from 'vitest';
import {
  SEND_TOUR,
  TOURS,
  WORKSPACE_TOUR,
  canGoBack,
  enterChapter,
  isLastStep,
  isTourId,
  nextStep,
  pickTarget,
  placeCard,
  previousStep,
  startTour,
  stepCounter,
  type TourStep,
} from './tours';

const step = (id: string, chapter?: string): TourStep => ({
  id,
  targets: [],
  title: id,
  body: id,
  ...(chapter ? { chapter } : {}),
});

const flat = [step('a'), step('b'), step('c')];
const flow = [
  step('d1', 'documents'),
  step('d2', 'documents'),
  step('r1', 'recipients'),
  step('v1', 'review'),
];

describe('tour definitions', () => {
  it('keeps the workspace tour between five and eight steps, opening with the mark', () => {
    expect(WORKSPACE_TOUR.steps.length).toBeGreaterThanOrEqual(5);
    expect(WORKSPACE_TOUR.steps.length).toBeLessThanOrEqual(8);
    expect(WORKSPACE_TOUR.steps[0]!.mark).toBe(true);
  });

  it('gives every step a unique id and short copy', () => {
    for (const tour of Object.values(TOURS)) {
      const ids = tour.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of tour.steps) {
        expect(s.title.length).toBeLessThanOrEqual(40);
        expect(s.body.length).toBeLessThanOrEqual(170);
      }
    }
  });

  it('walks the send flow in its own order', () => {
    const order = [...new Set(SEND_TOUR.steps.map((s) => s.chapter))];
    expect(order).toEqual(['documents', 'recipients', 'fields', 'review']);
  });

  it('mentions Aadhaar eSign only as an identity check', () => {
    const aadhaar = SEND_TOUR.steps.filter((s) => /aadhaar/i.test(s.body));
    expect(aadhaar.map((s) => s.id)).toEqual(['identity']);
    expect(aadhaar[0]!.body).toMatch(/Aadhaar eSign as an identity check/);
  });

  it('knows its tour ids and nothing else', () => {
    expect(isTourId('workspace')).toBe(true);
    expect(isTourId('send')).toBe(true);
    expect(isTourId('signer')).toBe(false);
    expect(isTourId(7)).toBe(false);
  });
});

describe('moving through a tour', () => {
  it('goes forward and back, and ends after the last step', () => {
    let p = startTour(flat);
    expect(p.index).toBe(0);
    expect(canGoBack(flat, p)).toBe(false);
    p = nextStep(flat, p);
    expect(p.index).toBe(1);
    expect(canGoBack(flat, p)).toBe(true);
    expect(previousStep(flat, p).index).toBe(0);
    p = nextStep(flat, nextStep(flat, p));
    expect(p).toEqual({ index: null, passed: [''], finished: true });
  });

  it('marks only the final step as the last one', () => {
    expect(isLastStep(flat, { index: 1, passed: [], finished: false })).toBe(false);
    expect(isLastStep(flat, { index: 2, passed: [], finished: false })).toBe(true);
  });

  it('ignores moves once finished or while waiting', () => {
    const done = { index: null, passed: [''], finished: true };
    expect(nextStep(flat, done)).toBe(done);
    expect(previousStep(flat, done)).toBe(done);
  });

  it('starts an empty tour as finished', () => {
    expect(startTour([]).finished).toBe(true);
  });
});

describe('a tour that follows the send flow', () => {
  it('waits at the end of a chapter until the next flow step opens', () => {
    let p = startTour(flow, 'documents');
    p = nextStep(flow, nextStep(flow, p));
    expect(p).toEqual({ index: null, passed: ['documents'], finished: false });
    p = enterChapter(flow, p, 'recipients');
    expect(p.index).toBe(2);
    expect(canGoBack(flow, p)).toBe(false);
  });

  it('picks up where the person is when they move on mid-chapter', () => {
    const p = enterChapter(flow, startTour(flow, 'documents'), 'recipients');
    expect(p).toEqual({ index: 2, passed: ['documents'], finished: false });
  });

  it('starts on the chapter a resumed draft opens on', () => {
    expect(startTour(flow, 'review').index).toBe(3);
  });

  it('stays quiet on a chapter it has already shown', () => {
    let p = enterChapter(flow, startTour(flow, 'documents'), 'recipients');
    p = enterChapter(flow, p, 'documents');
    expect(p.index).toBeNull();
    expect(p.passed).toEqual(['documents', 'recipients']);
  });

  it('counts the last chapter as the end only when every other one was seen', () => {
    const late = startTour(flow, 'review');
    expect(isLastStep(flow, late)).toBe(false);
    expect(nextStep(flow, late)).toEqual({ index: null, passed: ['review'], finished: false });
    const all = { index: 3, passed: ['documents', 'recipients'], finished: false };
    expect(isLastStep(flow, all)).toBe(true);
    expect(nextStep(flow, all).finished).toBe(true);
  });

  it('waits on a flow step with no steps of its own', () => {
    const p = enterChapter(flow, startTour(flow, 'documents'), 'fields');
    expect(p.index).toBeNull();
  });
});

describe('stepCounter', () => {
  it('counts from one', () => {
    expect(stepCounter(1, 6)).toBe('2 of 6');
  });
});

describe('pickTarget', () => {
  const page: Record<string, { id: string; shown: boolean }[]> = {
    '#rail': [{ id: 'rail', shown: false }],
    '#menu': [{ id: 'menu', shown: true }],
    '.many': [
      { id: 'hidden', shown: false },
      { id: 'second', shown: true },
    ],
  };
  const find = (s: string) => page[s] ?? [];
  const visible = (e: { shown: boolean }) => e.shown;

  it('takes the first selector with something on screen', () => {
    expect(pickTarget(['#rail', '#menu'], find, visible)?.id).toBe('menu');
    expect(pickTarget(['.many'], find, visible)?.id).toBe('second');
  });

  it('finds nothing when no element is on screen', () => {
    expect(pickTarget(['#rail', '#gone'], find, visible)).toBeNull();
    expect(pickTarget([], find, visible)).toBeNull();
  });
});

describe('placeCard', () => {
  const card = { width: 360, height: 200 };
  const desk = { width: 1440, height: 900 };

  it('is a sheet on a phone, on the edge away from the element', () => {
    const phone = { width: 390, height: 844 };
    expect(placeCard({ top: 10, left: 10, width: 40, height: 40 }, card, phone)).toEqual({
      mode: 'sheet',
      edge: 'bottom',
    });
    expect(placeCard({ top: 780, left: 10, width: 370, height: 50 }, card, phone)).toEqual({
      mode: 'sheet',
      edge: 'top',
    });
    expect(placeCard(null, card, phone)).toEqual({ mode: 'sheet', edge: 'bottom' });
  });

  it('centres the card with nothing to point at', () => {
    expect(placeCard(null, card, desk)).toEqual({
      mode: 'float',
      side: 'center',
      top: 350,
      left: 540,
    });
  });

  it('sits below an element with room under it, kept inside the window', () => {
    const placed = placeCard({ top: 20, left: 1380, width: 50, height: 40 }, card, desk);
    expect(placed).toEqual({ mode: 'float', side: 'bottom', top: 74, left: 1068 });
  });

  it('tries the preferred side first', () => {
    const rail = { top: 300, left: 8, width: 68, height: 56 };
    expect(placeCard(rail, card, desk, 'right')).toMatchObject({ side: 'right', left: 90 });
    expect(placeCard(rail, card, desk)).toMatchObject({ side: 'bottom' });
  });

  it('falls back to another side when the preferred one has no room', () => {
    const footer = { top: 820, left: 600, width: 200, height: 60 };
    expect(placeCard(footer, card, desk, 'bottom')).toMatchObject({ side: 'right' });
  });

  it('centres the card when no side has room', () => {
    const huge = { top: 0, left: 0, width: 1440, height: 900 };
    expect(placeCard(huge, card, desk)).toMatchObject({ side: 'center' });
  });
});
