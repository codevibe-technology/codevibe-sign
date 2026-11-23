export const TOUR_IDS = ['workspace', 'send'] as const;
export type TourId = (typeof TOUR_IDS)[number];

/** `started` keeps a tour from opening on its own again even when it was left half way. */
export const TOUR_STATUSES = ['started', 'done', 'skipped'] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];

export const isTourId = (value: unknown): value is TourId =>
  typeof value === 'string' && (TOUR_IDS as readonly string[]).includes(value);

export interface TourStep {
  id: string;
  /** Tried in order; the first one on screen is highlighted. None: the card sits on its own. */
  targets: readonly string[];
  title: string;
  body: string;
  /** Left out when none of its targets is on screen, instead of shown on its own. */
  optional?: boolean;
  /** The send flow step it belongs to; the tour waits there until the person arrives. */
  chapter?: string;
  /** Shows the Codevibe Sign mark above the title. */
  mark?: boolean;
  /** The side of the element the card tries first. */
  side?: Side;
  /** Added to the body when only a later target is on screen, such as the phone menu. */
  fallbackNote?: string;
}

export interface TourDefinition {
  id: TourId;
  name: string;
  steps: readonly TourStep[];
}

const nav = (item: string) => [`[data-tour="nav-${item}"]`, '[data-tour="nav-menu"]'];
const RAIL = { side: 'right', fallbackNote: 'Open the menu to find it.' } as const;

export const WORKSPACE_TOUR: TourDefinition = {
  id: 'workspace',
  name: 'Welcome to your workspace',
  steps: [
    {
      id: 'welcome',
      targets: [],
      mark: true,
      title: 'Welcome to your workspace',
      body: 'A quick look around. It takes under a minute, and you can skip it at any time.',
    },
    {
      id: 'workspace',
      ...RAIL,
      targets: ['[data-tour="workspace-switcher"]', '[data-tour="workspace-name"]'],
      fallbackNote: 'The switcher is in the menu.',
      title: 'Your workspace',
      body: 'Everything you send belongs to this workspace. Use the switcher to move to another one or create a new one.',
    },
    {
      id: 'send',
      targets: ['[data-tour="send-document"]'],
      optional: true,
      title: 'Send a document',
      body: 'Upload a PDF, add who signs, place the fields and send. Four short steps, saved as you go.',
    },
    {
      id: 'envelopes',
      ...RAIL,
      targets: nav('envelopes'),
      title: 'Envelopes',
      body: 'Every document you send lives here, with its progress, reminders and the sealed copy.',
    },
    {
      id: 'templates',
      ...RAIL,
      targets: nav('templates'),
      title: 'Templates',
      body: 'Keep documents you send often, with recipients and fields in place. Send one again, or to many people from a CSV file.',
    },
    {
      id: 'verify',
      ...RAIL,
      targets: nav('verify'),
      title: 'Verify',
      body: 'Got a signed PDF back? Check that it is exactly the document this workspace sealed.',
    },
    {
      id: 'settings',
      ...RAIL,
      targets: nav('settings'),
      title: 'Settings',
      body: 'Invite your team and pick their roles, add your brand, turn on Aadhaar eSign, and see your plan and usage.',
    },
    {
      id: 'docs',
      ...RAIL,
      targets: nav('docs'),
      title: 'Help when you need it',
      body: 'The docs explain every step. You can replay this tour from your account menu.',
    },
  ],
};

export const SEND_TOUR: TourDefinition = {
  id: 'send',
  name: 'Send your first document',
  steps: [
    {
      id: 'steps',
      chapter: 'documents',
      targets: ['[data-tour="send-steps"]', '[data-tour="send-progress"]'],
      title: 'Send your first document',
      body: 'Four steps: documents, recipients, fields, then review. Your draft saves as you go.',
    },
    {
      id: 'upload',
      chapter: 'documents',
      targets: ['[data-testid="file-drop"]', '[aria-label="Documents"]'],
      title: 'Add your PDFs',
      body: 'Drop one or more PDFs here, or click to pick them. Each file is checked as you add it.',
    },
    {
      id: 'continue',
      chapter: 'documents',
      targets: ['[data-tour="send-next"]'],
      title: 'Then continue',
      body: 'Press Continue when your files are in. The tour picks up again on the next step.',
    },
    {
      id: 'order',
      chapter: 'recipients',
      targets: ['[data-tour="signing-order"]'],
      title: 'Signing order',
      body: 'Send to one person after another, or to everyone at once.',
    },
    {
      id: 'people',
      chapter: 'recipients',
      targets: ['[data-tour="recipients-list"]', '[data-tour="recipients-add"]'],
      title: 'Who takes part',
      body: 'Add each person with a role: signs, approves, or gets a copy. Their colour follows them onto the pages.',
    },
    {
      id: 'identity',
      chapter: 'recipients',
      targets: ['[data-tour="identity-check"]', '[data-tour="recipients-add"]'],
      title: 'Identity check',
      body: 'Choose how each signer proves who they are: the email link, a code by email or SMS, or Aadhaar eSign as an identity check.',
    },
    {
      id: 'signer',
      chapter: 'fields',
      targets: ['.cvs-recipients'],
      optional: true,
      title: 'One colour per signer',
      body: 'Pick whose fields you are placing. The tray and every box you place take that signer’s colour.',
    },
    {
      id: 'tray',
      chapter: 'fields',
      targets: ['.cvs-tray'],
      title: 'Drag or click to place',
      body: 'Drag a field onto the page, or click it to drop it on the page in view. Select a placed field to resize it, make it optional, or show it on more pages.',
    },
    {
      id: 'pages',
      chapter: 'fields',
      targets: ['.cvs-thumbs'],
      optional: true,
      title: 'Page rail',
      body: 'Jump between pages and documents. Each page shows how many fields it has.',
    },
    {
      id: 'quick',
      chapter: 'fields',
      targets: ['.cvs-presets'],
      optional: true,
      title: 'Quick add',
      body: 'Add a signature on the last page, or initials on every page, in one click.',
    },
    {
      id: 'preview',
      chapter: 'fields',
      targets: ['[data-tour="send-preview"]'],
      optional: true,
      title: 'Preview as signer',
      body: 'See the pages the way each signer will, then go back to editing.',
    },
    {
      id: 'review',
      chapter: 'review',
      targets: ['[data-tour="send-next"]'],
      title: 'Review and send',
      body: 'Check the email, reminders and expiry, then press Send now. Each step then shows on the envelope’s page.',
    },
  ],
};

export const TOURS: Record<TourId, TourDefinition> = {
  workspace: WORKSPACE_TOUR,
  send: SEND_TOUR,
};

/** Where a tour stands: the step on screen, or none while it waits for the next chapter. */
export interface TourProgress {
  index: number | null;
  /** Chapters already walked through (or left for the next flow step). */
  passed: readonly string[];
  finished: boolean;
}

const chapterOf = (steps: readonly TourStep[], index: number) => steps[index]?.chapter ?? '';

const chapters = (steps: readonly TourStep[]) => [...new Set(steps.map((s) => s.chapter ?? ''))];

function firstOf(steps: readonly TourStep[], chapter: string): number {
  return steps.findIndex((s) => (s.chapter ?? '') === chapter);
}

/** A fresh run, at the start of `chapter` when the tour has chapters and one is given. */
export function startTour(steps: readonly TourStep[], chapter?: string): TourProgress {
  const at = chapter === undefined ? 0 : firstOf(steps, chapter);
  return { index: Math.max(at, 0), passed: [], finished: steps.length === 0 };
}

/** One step on; past the last step of a chapter the tour waits, past the last chapter it ends. */
export function nextStep(steps: readonly TourStep[], progress: TourProgress): TourProgress {
  if (progress.index === null || progress.finished) return progress;
  const here = chapterOf(steps, progress.index);
  const next = progress.index + 1;
  if (next < steps.length && chapterOf(steps, next) === here) return { ...progress, index: next };
  const passed = progress.passed.includes(here) ? progress.passed : [...progress.passed, here];
  const left = chapters(steps).filter((c) => !passed.includes(c));
  return { index: null, passed, finished: left.length === 0 };
}

/** One step back, never into an earlier chapter: its elements are no longer on screen. */
export function previousStep(steps: readonly TourStep[], progress: TourProgress): TourProgress {
  if (progress.index === null || progress.index === 0) return progress;
  const back = progress.index - 1;
  if (chapterOf(steps, back) !== chapterOf(steps, progress.index)) return progress;
  return { ...progress, index: back };
}

export function canGoBack(steps: readonly TourStep[], progress: TourProgress): boolean {
  return previousStep(steps, progress) !== progress;
}

/** Whether the step on screen is the last one the tour has to show. */
export function isLastStep(steps: readonly TourStep[], progress: TourProgress): boolean {
  if (progress.index === null) return false;
  const here = chapterOf(steps, progress.index);
  const next = progress.index + 1;
  if (next < steps.length && chapterOf(steps, next) === here) return false;
  return chapters(steps).every((c) => c === here || progress.passed.includes(c));
}

/**
 * The person moved to another flow step. A chapter not walked through yet starts; the one they
 * left counts as passed. A chapter already passed keeps the tour waiting.
 */
export function enterChapter(
  steps: readonly TourStep[],
  progress: TourProgress,
  chapter: string,
): TourProgress {
  if (progress.finished) return progress;
  const current = progress.index === null ? null : chapterOf(steps, progress.index);
  if (current === chapter) return progress;
  const passed =
    current !== null && !progress.passed.includes(current)
      ? [...progress.passed, current]
      : progress.passed;
  const at = firstOf(steps, chapter);
  if (at < 0 || passed.includes(chapter)) return { ...progress, index: null, passed };
  return { ...progress, index: at, passed };
}

/** `3 of 8`: where the step sits in the whole tour. */
export const stepCounter = (index: number, total: number) => `${index + 1} of ${total}`;

/** The first selector, in order, whose element `visible` accepts. */
export function pickTarget<E>(
  selectors: readonly string[],
  find: (selector: string) => readonly E[],
  visible: (element: E) => boolean,
): E | null {
  for (const selector of selectors) {
    for (const element of find(selector)) if (visible(element)) return element;
  }
  return null;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Side = 'top' | 'bottom' | 'left' | 'right';

export type Placement =
  | { mode: 'sheet'; edge: 'top' | 'bottom' }
  | { mode: 'float'; side: Side | 'center'; top: number; left: number };

/** Narrower than this, the card is a sheet along the bottom (or top) edge of the screen. */
export const SHEET_BELOW = 640;
const GAP = 14;
const MARGIN = 12;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the card goes. On a phone it is a sheet on the edge away from the highlighted element.
 * Otherwise it sits beside the element, on the first side with room (`prefer`, then below,
 * right, above, left), kept inside the window; with nothing to point at it is centred.
 */
export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer?: Side,
): Placement {
  if (viewport.width < SHEET_BELOW) {
    const middle = target ? target.top + target.height / 2 : 0;
    return { mode: 'sheet', edge: target && middle > viewport.height * 0.55 ? 'top' : 'bottom' };
  }
  const centred = {
    mode: 'float' as const,
    side: 'center' as const,
    top: Math.max(MARGIN, (viewport.height - card.height) / 2),
    left: Math.max(MARGIN, (viewport.width - card.width) / 2),
  };
  if (!target) return centred;
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const alongX = clamp(
    target.left + target.width / 2 - card.width / 2,
    MARGIN,
    viewport.width - card.width - MARGIN,
  );
  const alongY = clamp(
    target.top + target.height / 2 - card.height / 2,
    MARGIN,
    viewport.height - card.height - MARGIN,
  );
  const options = [
    {
      side: 'bottom' as const,
      fits: bottom + GAP + card.height + MARGIN <= viewport.height,
      top: bottom + GAP,
      left: alongX,
    },
    {
      side: 'right' as const,
      fits: right + GAP + card.width + MARGIN <= viewport.width,
      top: alongY,
      left: right + GAP,
    },
    {
      side: 'top' as const,
      fits: target.top - GAP - card.height >= MARGIN,
      top: target.top - GAP - card.height,
      left: alongX,
    },
    {
      side: 'left' as const,
      fits: target.left - GAP - card.width >= MARGIN,
      top: alongY,
      left: target.left - GAP - card.width,
    },
  ];
  const chosen = options.find((o) => o.fits && o.side === prefer) ?? options.find((o) => o.fits);
  if (!chosen) return centred;
  return { mode: 'float', side: chosen.side, top: chosen.top, left: chosen.left };
}
