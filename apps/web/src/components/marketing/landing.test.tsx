// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));
vi.mock('@/server/actions/personal', () => ({ updatePreferencesAction: vi.fn() }));

import { FREE_PLAN_LIMITS, planFeatures } from '@/lib/plans';
import type { PricingView } from '@/server/billing/pricing';

const FEATURES = planFeatures({ mode: 'hosted', freeOverrides: {} });
const PRICING: PricingView = {
  cloudMonth: '₹999',
  cloudYear: '₹9,990',
  yearSaving: '2 months free',
  yearSavingAmount: '₹1,998',
  extraMember: '₹99',
  includedMembers: 25,
  esignFree: '₹35 per eSign',
  esignCloud: '₹25 per eSign',
  installHelp: '₹1,999',
  gstPercent: 18,
  graceDays: 7,
  paymentsOpen: true,
  testMode: false,
  operatorEmail: null,
  hostingOffers: [],
};
const { Landing } = await import('./landing');
const { LegalPage, LegalSection } = await import('./legal-page');

describe('Landing', () => {
  it('leads with the promise and the two ways in', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
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
        features={FEATURES}
        pricing={PRICING}
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
    render(<Landing features={FEATURES} pricing={PRICING} viewer={null} />);
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
    render(<Landing features={FEATURES} pricing={PRICING} />);
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
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const ways = screen.getAllByRole('link', { name: /Start free/ });
    // the header, the hero, the Free and Cloud plans and the closing call to action
    expect(ways).toHaveLength(5);
    for (const link of ways) expect(link).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByRole('link', { name: /Go to dashboard/ })).toBeNull();
  });

  it('tells the six steps with a still and a description of each', () => {
    const { container } = render(<Landing features={FEATURES} pricing={PRICING} />);
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
      expect(step.querySelector('video source')).toHaveAttribute('src', `/home/${clip}.mp4`);
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
    render(<Landing features={FEATURES} pricing={PRICING} />);
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
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const developers = document.getElementById('developers')!;
    const code = within(developers).getByLabelText(
      'Sending an envelope with the TypeScript client',
    );
    expect(code.textContent).toContain("from '@codevibe_technology/sign-client'");
    expect(code.textContent).toContain('sign.envelopes.create(');
  });

  it('prices from the plan limits and the prices it is given', () => {
    render(
      <Landing
        features={planFeatures({ mode: 'hosted', freeOverrides: { envelopesPerMonth: 20 } })}
        pricing={PRICING}
      />,
    );
    const pricing = document.getElementById('pricing')!;
    expect(within(pricing).getByText('Envelopes sent: 20 envelopes a month')).toBeTruthy();
    expect(
      within(pricing).getByText(
        `Members: ${FREE_PLAN_LIMITS.members} members across your workspaces`,
      ),
    ).toBeTruthy();
    expect(within(pricing).getByText('Webhooks: not included')).toBeTruthy();
    expect(within(pricing).getByText('Envelopes sent: unlimited')).toBeTruthy();
    expect(within(pricing).getByText('₹999')).toBeTruthy();
    expect(within(pricing).getByText(/₹9,990 if you pay for a year, 2 months free/)).toBeTruthy();
    expect(within(pricing).getByText(/More members are ₹99 each a month/)).toBeTruthy();
    expect(within(pricing).getByText('Aadhaar eSign: ₹35 per eSign, prepaid')).toBeTruthy();
    expect(within(pricing).getByText('Aadhaar eSign: ₹25 per eSign, prepaid')).toBeTruthy();
    expect(
      within(pricing).getByRole('link', { name: 'Have it installed for you' }),
    ).toHaveAttribute('href', '/install-help');
    expect(within(pricing).getByText(/do not include 18% GST/)).toBeTruthy();
    expect(
      within(pricing).getByText('No limits on envelopes, members or storage'),
    ).toBeInTheDocument();
  });

  it('says a price is coming while none is set, and never how a price is made up', () => {
    render(
      <Landing
        features={FEATURES}
        pricing={{
          ...PRICING,
          esignFree: 'Price coming soon',
          esignCloud: 'Price coming soon',
          paymentsOpen: false,
        }}
      />,
    );
    const pricing = document.getElementById('pricing')!;
    expect(within(pricing).getAllByText('Aadhaar eSign: price coming soon, prepaid')).toHaveLength(
      2,
    );
    expect(within(pricing).getByText('Paying for Cloud opens shortly.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/markup|at cost|provider cost|\+ ?₹10/i);
  });

  it('answers the legal, data and limit questions', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const faq = document.getElementById('faq')!;
    expect(within(faq).getByText(/Information Technology Act, 2000/)).toBeTruthy();
    expect(within(faq).getByText('Is Aadhaar eSign available?')).toBeTruthy();
    expect(
      within(faq).getByText(/₹35 per eSign on the Free plan\s+and ₹25 per eSign on Cloud/),
    ).toBeTruthy();
    expect(within(faq).getByText('How does paying for Cloud work?')).toBeTruthy();
    expect(within(faq).getByText('Where is my data kept?')).toBeTruthy();
    expect(within(faq).getByText(/Nothing already sent is affected/)).toBeTruthy();
  });

  it('opens links to other sites in a new tab and says so', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
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
    render(<Landing features={FEATURES} pricing={PRICING} />);
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
