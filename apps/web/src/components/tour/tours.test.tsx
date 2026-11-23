// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TourStatus } from '@/lib/tours';

const nav = vi.hoisted(() => ({ pathname: '/dashboard/acme', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
}));
const record = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/server/actions/tours', () => ({ recordTourAction: record }));
vi.mock('@/server/actions/personal', () => ({ updatePreferencesAction: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const { TourProvider, useTours } = await import('./tour-provider');
const { SendTour, WorkspaceTour } = await import('./guided-tours');
const { TourRunner } = await import('./tour-runner');
const { TourSettings } = await import('@/components/settings/tour-settings');
const { UserMenu } = await import('@/components/shell/user-menu');

/** jsdom lays nothing out: elements marked `data-box` get a size, everything else has none. */
function layOut() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const shown = this.closest('[data-box]') !== null || this.hasAttribute('data-tour-card');
    const size = shown ? 40 : 0;
    return {
      x: 100,
      y: 100,
      top: 100,
      left: 100,
      width: size * 4,
      height: size,
      right: 100 + size * 4,
      bottom: 100 + size,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  layOut();
  Element.prototype.scrollIntoView = vi.fn();
  nav.pathname = '/dashboard/acme';
  nav.push.mockReset();
  record.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const settle = async (ms = 600) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function Rail() {
  return (
    <div>
      <button data-box data-tour="workspace-switcher">
        Acme
      </button>
      <a data-box data-tour="send-document" href="#send">
        Send a document
      </a>
      {['envelopes', 'templates', 'verify', 'settings', 'docs'].map((item) => (
        <a key={item} data-box data-tour={`nav-${item}`} href={`#${item}`}>
          {item}
        </a>
      ))}
    </div>
  );
}

function Workspace({
  statuses = {},
  children = <Rail />,
}: {
  statuses?: Partial<Record<'workspace' | 'send', TourStatus>>;
  children?: React.ReactNode;
}) {
  return (
    <TourProvider slug="acme" statuses={statuses} canSend>
      {children}
      <WorkspaceTour />
    </TourProvider>
  );
}

const card = () => screen.queryByRole('dialog');

describe('the workspace tour', () => {
  it('opens once on the dashboard of someone new, and records that it started', async () => {
    render(<Workspace />);
    expect(card()).toBeNull();
    await settle();
    expect(card()).toHaveAccessibleName('Welcome to your workspace');
    expect(screen.getByText('1 of 8')).toBeInTheDocument();
    expect(record).toHaveBeenCalledWith({ tour: 'workspace', status: 'started' });
    expect(screen.getByRole('button', { name: /Next/ })).toHaveFocus();
  });

  it('stays closed for someone who finished or skipped it', async () => {
    render(<Workspace statuses={{ workspace: 'skipped' }} />);
    await settle();
    expect(card()).toBeNull();
  });

  it('opens only on the dashboard itself', async () => {
    nav.pathname = '/dashboard/acme/envelopes';
    render(<Workspace />);
    await settle();
    expect(card()).toBeNull();
  });

  it('walks forward and back with buttons and arrow keys, and ends as done', async () => {
    render(<Workspace />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await settle(150);
    expect(card()).toHaveAccessibleName('Your workspace');
    expect(screen.getByText('2 of 8')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /Next/ }), { key: 'ArrowRight' });
    await settle(150);
    expect(card()).toHaveAccessibleName('Send a document');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await settle(150);
    expect(card()).toHaveAccessibleName('Your workspace');
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      await settle(150);
    }
    expect(card()).toHaveAccessibleName('Help when you need it');
    expect(screen.queryByRole('button', { name: 'Skip tour' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await settle(50);
    expect(card()).toBeNull();
    expect(record).toHaveBeenLastCalledWith({ tour: 'workspace', status: 'done' });
  });

  it('closes on Escape, Close or Skip, and is saved as skipped', async () => {
    for (const how of ['escape', 'close', 'skip'] as const) {
      record.mockClear();
      const { unmount } = render(<Workspace />);
      await settle();
      if (how === 'escape') fireEvent.keyDown(document.body, { key: 'Escape' });
      else if (how === 'close')
        fireEvent.click(screen.getByRole('button', { name: 'Close the tour' }));
      else fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
      await settle(50);
      expect(card()).toBeNull();
      expect(record).toHaveBeenLastCalledWith({ tour: 'workspace', status: 'skipped' });
      unmount();
    }
  });

  it('points at the phone menu when the rail is hidden, and says so', async () => {
    render(
      <Workspace>
        <button data-box data-tour="nav-menu">
          Menu
        </button>
        <span data-box data-tour="workspace-name">
          Acme
        </span>
        <a data-tour="nav-envelopes" href="#e">
          Envelopes
        </a>
      </Workspace>,
    );
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await settle(3000);
    // The switcher is in the menu too; the send button is left out as it is optional.
    expect(card()).toHaveAccessibleDescription(/The switcher is in the menu\.$/);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await settle(3000);
    expect(card()).toHaveAccessibleName('Envelopes');
    expect(card()).toHaveAccessibleDescription(/Open the menu to find it\.$/);
  });

  it('announces each step to screen readers', async () => {
    render(<Workspace />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await settle(150);
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      /^Step 2 of 8\. Your workspace\./,
    );
  });

  it('opens again when replayed from Settings, on the dashboard', async () => {
    nav.pathname = '/dashboard/acme/settings/personal';
    const { rerender } = render(
      <Workspace statuses={{ workspace: 'done', send: 'skipped' }}>
        <Rail />
        <TourSettings />
      </Workspace>,
    );
    expect(screen.getByText(/Finished\./)).toBeInTheDocument();
    expect(screen.getByText(/Skipped\./)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Replay the tour: Welcome to your workspace' }),
    );
    expect(nav.push).toHaveBeenCalledWith('/dashboard/acme');
    nav.pathname = '/dashboard/acme';
    rerender(
      <Workspace statuses={{ workspace: 'done', send: 'skipped' }}>
        <Rail />
        <TourSettings />
      </Workspace>,
    );
    await settle();
    expect(card()).toHaveAccessibleName('Welcome to your workspace');
    // A replay is not a first run: nothing is saved until it ends.
    expect(record).not.toHaveBeenCalled();
  });
});

function SendPage({ initial = 'documents' as const }: { initial?: 'documents' | 'review' }) {
  const [step, setStep] = useState<'documents' | 'recipients' | 'fields' | 'review'>(initial);
  return (
    <div>
      <nav data-box data-tour="send-steps">
        Steps
      </nav>
      {step === 'documents' ? <div data-box data-testid="file-drop" /> : null}
      {step === 'recipients' ? (
        <>
          <fieldset data-box data-tour="signing-order" />
          <div data-box data-tour="recipients-add" />
        </>
      ) : null}
      {step === 'fields' ? <div data-box className="cvs-tray" /> : null}
      <button data-box data-tour="send-next" onClick={() => setStep(next[step])}>
        Continue
      </button>
      <SendTour step={step} />
    </div>
  );
}
const next = {
  documents: 'recipients',
  recipients: 'fields',
  fields: 'review',
  review: 'review',
} as const;

function Covered() {
  const tours = useTours();
  return <p data-testid="covered">{String(tours?.covered)}</p>;
}

describe('the sending tour', () => {
  it('follows the send flow, waiting between its steps', async () => {
    render(
      <TourProvider slug="acme" statuses={{ workspace: 'done' }} canSend>
        <SendPage />
        <Covered />
      </TourProvider>,
    );
    expect(screen.getByTestId('covered')).toHaveTextContent('true');
    await settle();
    expect(card()).toHaveAccessibleName('Send your first document');
    expect(screen.getByText('1 of 12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await settle(150);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await settle(150);
    expect(card()).toHaveAccessibleName('Then continue');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await settle(50);
    expect(card()).toBeNull();
    // Focus goes to the button the last step pointed at.
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await settle(150);
    expect(card()).toHaveAccessibleName('Signing order');
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull();
  });

  it('skips steps with nothing on screen and ends on review', async () => {
    render(
      <TourProvider slug="acme" statuses={{}} canSend>
        <SendPage />
      </TourProvider>,
    );
    await settle();
    const continueFlow = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await settle(3000);
    };
    await continueFlow();
    await continueFlow();
    // The signer list is not there, so the fields part opens on the tray.
    expect(card()).toHaveAccessibleName('Drag or click to place');
    await continueFlow();
    expect(card()).toHaveAccessibleName('Review and send');
    expect(screen.getByText('12 of 12')).toBeInTheDocument();
  });

  it('does not open for someone who has seen it', async () => {
    render(
      <TourProvider slug="acme" statuses={{ send: 'started' }} canSend>
        <SendPage />
      </TourProvider>,
    );
    await settle();
    expect(card()).toBeNull();
  });

  it('renders nothing outside a workspace', async () => {
    render(<SendPage />);
    await settle();
    expect(card()).toBeNull();
  });
});

describe('TourRunner', () => {
  it('lets a menu or dialog of the page keep its own Escape', async () => {
    const onClose = vi.fn();
    render(
      <>
        <div role="menu">
          <button>Item</button>
        </div>
        <TourRunner
          steps={[{ id: 'a', targets: [], title: 'Alone', body: 'No element.' }]}
          index={0}
          canGoBack={false}
          isLast
          pausesAfter={false}
          onNext={vi.fn()}
          onBack={vi.fn()}
          onClose={onClose}
          onMissing={vi.fn()}
        />
      </>,
    );
    await settle(50);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Item' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dims the page without catching its clicks', async () => {
    render(
      <TourRunner
        steps={[{ id: 'a', targets: [], title: 'Alone', body: 'No element.' }]}
        index={0}
        canGoBack={false}
        isLast={false}
        pausesAfter={false}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onClose={vi.fn()}
        onMissing={vi.fn()}
      />,
    );
    await settle(50);
    const dim = document.querySelector('[data-tour-spotlight]');
    expect(dim).toHaveClass('pointer-events-none');
    expect(card()).toHaveAttribute('aria-modal', 'false');
  });
});

describe('replaying from the account menu', () => {
  const asha = { name: 'Asha Rao', email: 'asha@example.com' };

  it('offers both tours and opens the page each starts on', async () => {
    vi.useRealTimers();
    const onNavigate = vi.fn();
    render(
      <TourProvider slug="acme" statuses={{ workspace: 'done', send: 'done' }} canSend>
        <UserMenu
          user={asha}
          personalHref="/dashboard/acme/settings/personal"
          onNavigate={onNavigate}
        />
      </TourProvider>,
    );
    const user = userEvent.setup();
    const open = () => user.click(screen.getByRole('button', { name: 'Account menu' }));
    await open();
    await user.click(await screen.findByRole('menuitem', { name: 'Replay the sending tour' }));
    expect(nav.push).toHaveBeenCalledWith('/dashboard/acme/envelopes/new');
    expect(onNavigate).toHaveBeenCalled();
    await open();
    await user.click(await screen.findByRole('menuitem', { name: 'Replay the workspace tour' }));
    expect(nav.push).toHaveBeenLastCalledWith('/dashboard/acme');
  });

  it('leaves out the sending tour for someone who cannot send', async () => {
    vi.useRealTimers();
    render(
      <TourProvider slug="acme" statuses={{}} canSend={false}>
        <UserMenu user={asha} personalHref="/dashboard/acme/settings/personal" />
      </TourProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Account menu' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Replay the workspace tour' }),
    ).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Replay the sending tour' })).toBeNull();
  });

  it('has no tour entries outside a workspace', async () => {
    vi.useRealTimers();
    render(<UserMenu user={asha} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');
    expect(screen.queryByText('Guided tours')).toBeNull();
  });
});
