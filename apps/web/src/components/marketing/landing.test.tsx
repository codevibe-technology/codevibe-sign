// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));
vi.mock('@/server/actions/personal', () => ({ updatePreferencesAction: vi.fn() }));

import { CLOUD_PLAN_LIMITS, FREE_PLAN_LIMITS } from '@/lib/plans';
const { Landing } = await import('./landing');
const { LegalPage, LegalSection } = await import('./legal-page');

describe('Landing', () => {
  it('leads with the promise and the two ways in', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Get it signed. Keep the proof.' }),
    ).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(within(hero).getByRole('link', { name: /Start free/ })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(within(hero).getByRole('link', { name: /^Self-host it/ })).toHaveAttribute(
      'href',
      'https://github.com/codevibe-technology/codevibe-sign',
    );
    expect(within(hero).getByRole('link', { name: 'Check it here' })).toHaveAttribute(
      'href',
      '/verify',
    );
    const footer = screen.getByRole('navigation', { name: 'Footer' });
    expect(within(footer).getByRole('link', { name: 'Verify a PDF' })).toHaveAttribute(
      'href',
      '/verify',
    );
  });

  it('offers a signed-in visitor their dashboard instead of the ways in', () => {
    render(
      <Landing
        free={FREE_PLAN_LIMITS}
        cloud={CLOUD_PLAN_LIMITS}
        viewer={{ name: 'Asha Rao', email: 'asha@example.com' }}
      />,
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(within(header).getByRole('button', { name: 'Account menu' })).toHaveTextContent('A');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Start free/ })).toBeNull();
    const toDashboard = screen.getAllByRole('link', { name: /Go to dashboard/ });
    // the hero, the Free plan and the closing call to action
    expect(toDashboard).toHaveLength(3);
    for (const link of toDashboard) expect(link).toHaveAttribute('href', '/dashboard');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Get it signed. Keep the proof.' }),
    ).toBeInTheDocument();
  });

  it('shows the ways in to everyone else', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} viewer={null} />);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(within(header).getByRole('link', { name: 'Start free' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
  });

  it('has every section, reachable from the header', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    for (const id of ['features', 'developers', 'open-source', 'pricing', 'faq']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    const nav = screen.getByRole('navigation', { name: 'Site' });
    expect(within(nav).getByRole('link', { name: 'How it works' })).toHaveAttribute(
      'href',
      '/#features',
    );
    expect(within(nav).getByRole('link', { name: 'Developers' })).toHaveAttribute(
      'href',
      '/#developers',
    );
    expect(within(nav).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/#pricing');
    expect(within(nav).getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
  });

  it('sends everyone else to sign-in from every call to action', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    const ways = screen.getAllByRole('link', { name: /Start free/ });
    // the header, the hero, the Free plan and the closing call to action
    expect(ways).toHaveLength(4);
    for (const link of ways) expect(link).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByRole('link', { name: /Go to dashboard/ })).toBeNull();
  });

  it('tells the six steps with a still and a description of each', () => {
    const { container } = render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    const story = document.getElementById('features')!;
    expect(
      within(story).getByRole('heading', {
        level: 2,
        name: 'From PDF to sealed copy, on any device',
      }),
    ).toBeInTheDocument();
    const steps = within(story).getByRole('list', { name: 'Steps' });
    expect(
      within(steps)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Step 1: Send',
      'Step 2: Sign',
      'Step 3: Seal',
      'Step 4: Track',
      'Step 5: Verify',
      'Step 6: Scale',
    ]);
    for (const [id, clip] of [
      ['send', 'send'],
      ['sign', 'sign-phone'],
      ['seal', 'sealed'],
      ['audit', 'audit'],
      ['verify', 'verify'],
      ['templates', 'bulk'],
    ] as const) {
      const step = document.getElementById(id)!;
      // only the step on the stage is read out; the others wait their turn
      expect(within(step).getByRole('heading', { level: 3, hidden: true })).toBeInTheDocument();
      expect(step.getAttribute('aria-hidden')).toBe(id === 'send' ? null : 'true');
      // the still that stands in for the clip when motion is reduced
      expect(step.querySelector('img')).toHaveAttribute('src', `/home/${clip}.webp`);
      expect(step.querySelector('video source')).toHaveAttribute('src', `/home/${clip}.webm`);
      expect(document.getElementById(`${id}-text`)!.textContent!.length).toBeGreaterThan(40);
    }
    // only the first step's clip is on the pinned stage before anyone scrolls
    const stage = within(story).getByRole('button', { name: /^Pause the clip: / });
    expect(stage.getAttribute('aria-describedby')).toBe('send-text');
    for (const video of container.querySelectorAll('video')) {
      expect(video).not.toHaveAttribute('autoplay');
      expect(['none', 'metadata']).toContain(video.getAttribute('preload'));
    }
  });

  it('shows the audit trail as a real hash chain', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    const proof = document.getElementById('proof')!;
    const entries = [...proof.querySelectorAll('figure ol > li')];
    expect(entries.map((li) => li.querySelector('code')?.textContent)).toEqual([
      'envelope.sent',
      'recipient.viewed',
      'recipient.authenticated',
      'recipient.signed',
      'envelope.completed',
    ]);
    expect(within(proof).getByText(/made-up people/)).toBeInTheDocument();
  });

  it('shows the API with a working client call', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    const developers = document.getElementById('developers')!;
    const code = within(developers).getByLabelText(
      'Sending an envelope with the TypeScript client',
    );
    expect(code.textContent).toContain("from '@codevibe_technology/sign-client'");
    expect(code.textContent).toContain('sign.envelopes.create(');
  });

  it('prices from the plan limits it is given', () => {
    render(
      <Landing free={{ ...FREE_PLAN_LIMITS, envelopesPerMonth: 20 }} cloud={CLOUD_PLAN_LIMITS} />,
    );
    const pricing = document.getElementById('pricing')!;
    expect(within(pricing).getByText('20 envelopes a month, bulk sends included')).toBeTruthy();
    expect(within(pricing).getByText('3 members')).toBeTruthy();
    expect(within(pricing).getByText('PDFs up to 10 MB, 25 MB per envelope')).toBeTruthy();
    expect(within(pricing).getByText('200 MB of stored documents')).toBeTruthy();
    expect(within(pricing).getByText('500 envelopes a month, bulk sends included')).toBeTruthy();
    expect(within(pricing).getByText('Unlimited templates')).toBeTruthy();
    expect(within(pricing).getByText('Coming soon')).toBeTruthy();
    expect(within(pricing).getByRole('link', { name: 'Upgrade by email' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:hello@codevibe\.in/),
    );
    expect(
      within(pricing).getByText('No limits on envelopes, members or storage'),
    ).toBeInTheDocument();
  });

  it('answers the legal, data and limit questions', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    const faq = document.getElementById('faq')!;
    expect(within(faq).getByText(/Information Technology Act, 2000/)).toBeTruthy();
    expect(within(faq).getByText('Is Aadhaar eSign available?')).toBeTruthy();
    expect(within(faq).getByText(/standalone\s+library/)).toBeTruthy();
    expect(within(faq).getByText('Where is my data kept?')).toBeTruthy();
    expect(within(faq).getByText(/Nothing already sent is affected/)).toBeTruthy();
  });

  it('opens links to other sites in a new tab and says so', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
    }
    const footer = screen.getByRole('navigation', { name: 'Footer' });
    expect(
      within(footer).getByRole('link', { name: 'Codevibe (opens in a new tab)' }),
    ).toHaveAttribute('href', 'https://codevibe.in');
    for (const name of ['Docs', 'Verify a PDF', 'Terms', 'Privacy']) {
      expect(within(footer).getByRole('link', { name })).not.toHaveAttribute('target');
    }
  });

  it('links the footer to docs, the verify page, GitHub, terms, privacy and Codevibe', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    const footer = screen.getByRole('navigation', { name: 'Footer' });
    const hrefs = within(footer)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/docs',
      '/verify',
      'https://github.com/codevibe-technology/codevibe-sign',
      '/terms',
      '/privacy',
      'https://codevibe.in',
    ]);
  });
});

describe('LegalPage', () => {
  it('shows the title, the date and the sections', () => {
    render(
      <LegalPage title="Privacy" updated="20 November 2026" intro={<p>Intro</p>}>
        <LegalSection title="What we store">
          <p>Names</p>
        </LegalSection>
      </LegalPage>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText('Last updated 20 November 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'What we store' })).toBeInTheDocument();
  });
});
