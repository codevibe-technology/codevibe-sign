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
      screen.getByRole('heading', { level: 1, name: 'Send documents for signature in minutes' }),
    ).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(within(hero).getByRole('link', { name: /Start free/ })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(within(hero).getByRole('link', { name: 'Self-host it' })).toHaveAttribute(
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
      screen.getByRole('heading', { level: 1, name: 'Send documents for signature in minutes' }),
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

  it('shows each step with its clip and a description of it', () => {
    const { container } = render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    for (const [id, clip] of [
      ['send', 'send'],
      ['sign', 'sign-phone'],
      ['seal', 'sealed'],
      ['audit', 'audit'],
      ['verify', 'verify'],
      ['templates', 'bulk'],
    ] as const) {
      const row = document.getElementById(id)!;
      expect(within(row).getByRole('heading', { level: 3 })).toBeInTheDocument();
      expect(row.querySelector('video source')).toHaveAttribute('src', `/home/${clip}.webm`);
      expect(row.querySelector('img')).toHaveAttribute('src', `/home/${clip}.webp`);
      const text = document.getElementById(`${id}-text`)!;
      expect(text.textContent!.length).toBeGreaterThan(40);
      expect(within(row).getByRole('button', { name: /^Play the clip: / })).toHaveAttribute(
        'aria-describedby',
        `${id}-text`,
      );
    }
    const videos = container.querySelectorAll('video');
    expect(videos).toHaveLength(8);
    for (const video of videos) {
      expect(video).toHaveAttribute('preload', 'none');
      expect(video).not.toHaveAttribute('autoplay');
    }
    expect(screen.getAllByRole('button', { name: /^Play the clip: / })).toHaveLength(8);
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
