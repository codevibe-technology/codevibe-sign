// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));
vi.mock('@/server/actions/personal', () => ({ updatePreferencesAction: vi.fn() }));

import { planFeatures } from '@/lib/plans';
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
const HEADLINE = 'Get documents signed. Keep the proof.';
const GITHUB = 'https://github.com/codevibe-technology/codevibe-sign';
const { Landing } = await import('./landing');
const { LegalPage, LegalSection } = await import('./legal-page');

const section = (id: string) => document.getElementById(id)!;

describe('Landing', () => {
  it('leads with one promise, Start free and Self-host', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    expect(screen.getByRole('heading', { level: 1, name: HEADLINE })).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(within(hero).getByRole('link', { name: /Start free/ })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(within(hero).getByRole('link', { name: /^Self-host/ })).toHaveAttribute('href', GITHUB);
    expect(within(hero).getByText('Free plan, no card needed')).toBeInTheDocument();
  });

  it('frames the real app in the hero, poster first and nothing playing on its own', () => {
    const { container } = render(<Landing features={FEATURES} pricing={PRICING} />);
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(within(hero).getByText('sign.codevibe.in')).toBeInTheDocument();
    expect(within(hero).getByText('Sample data')).toBeInTheDocument();
    const poster = hero.querySelector('img[src="/home/hero.webp"]')!;
    expect(poster).toHaveAttribute('loading', 'eager');
    expect(poster).toHaveAttribute('width', '1280');
    expect(poster).toHaveAttribute('height', '800');
    expect(within(hero).getByText(/The real app, with made-up people/)).toBeInTheDocument();
    for (const video of container.querySelectorAll('video')) {
      expect(video).not.toHaveAttribute('autoplay');
      expect(['none', 'metadata']).toContain(video.getAttribute('preload'));
    }
  });

  it('shows the trust strip under the hero', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const strip = screen.getByRole('region', { name: 'Why teams trust it' });
    expect(
      within(strip)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('span > span')?.textContent),
    ).toEqual([
      'PAdES seal',
      'Hash-chained trail',
      'Aadhaar eSign',
      'Open source',
      'Made in India',
    ]);
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
  });

  it('shows the ways in to everyone else, also from the folded menu', () => {
    render(<Landing features={FEATURES} pricing={PRICING} viewer={null} />);
    const header = screen.getByRole('banner');
    const signIn = within(header).getAllByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveLength(2);
    for (const link of signIn) expect(link).toHaveAttribute('href', '/sign-in');
    expect(within(header).getByRole('link', { name: 'Start free' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
  });

  it('has every section, reachable from the header on the same page', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const ids = ['how-it-works', 'aadhaar', 'features', 'proof', 'developers', 'pricing', 'faq'];
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
    for (const name of ['Site', 'Site menu']) {
      const nav = screen.getByRole('navigation', { name });
      expect(
        within(nav)
          .getAllByRole('link')
          .map((a) => a.getAttribute('href')),
      ).toEqual(expect.arrayContaining(['#how-it-works', '#aadhaar', '#pricing', '/docs']));
    }
    expect(
      within(screen.getByRole('navigation', { name: 'Site' })).getByRole('link', {
        name: 'Aadhaar eSign',
      }),
    ).toHaveAttribute('href', '#aadhaar');
  });

  it('sends everyone else to sign-in from every call to action', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const ways = screen.getAllByRole('link', { name: /Start free/ });
    // the header, the hero, the Free and Cloud plans and the closing call to action
    expect(ways).toHaveLength(5);
    for (const link of ways) expect(link).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByRole('link', { name: /Go to dashboard/ })).toBeNull();
  });

  it('explains how it works in three steps, each with a clip of the real app', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const how = section('how-it-works');
    expect(
      within(how).getByRole('heading', {
        level: 2,
        name: 'From PDF to sealed copy in three steps',
      }),
    ).toBeInTheDocument();
    expect(
      within(how)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      'Upload a PDF and place the fields',
      'People sign on any phone',
      'Get a sealed PDF anyone can check',
    ]);
    const clips = [...how.querySelectorAll('video source[type="video/mp4"]')].map((s) =>
      s.getAttribute('src'),
    );
    expect(clips).toEqual(['/home/send.mp4', '/home/sign-phone.mp4', '/home/sealed.mp4']);
    for (const [i, button] of within(how)
      .getAllByRole('button', { name: /^Play the clip: / })
      .entries()) {
      expect(button).toHaveAttribute('aria-describedby', `step-${i + 1}-text`);
    }
  });

  it('gives Aadhaar eSign its own section with the prices it is given', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const aadhaar = section('aadhaar');
    expect(
      within(aadhaar).getByRole('heading', {
        level: 2,
        name: 'Legally valid Aadhaar e-signatures, built in',
      }),
    ).toBeInTheDocument();
    expect(within(aadhaar).getByText('Aadhaar eSign, with Leegality')).toBeInTheDocument();
    expect(within(aadhaar).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect(within(aadhaar).getByText('They confirm with an Aadhaar OTP')).toBeInTheDocument();
    const prices = within(aadhaar).getByText('Free plan').closest('dl')!;
    expect(prices.textContent).toContain('₹35per eSign + GST');
    expect(prices.textContent).toContain('₹25per eSign + GST');
    expect(within(aadhaar).getByText('Prepaid credits that never expire')).toBeInTheDocument();
    expect(
      within(aadhaar).getByText('On Cloud, connect your own Leegality account instead'),
    ).toBeInTheDocument();
    expect(within(aadhaar).getByRole('link', { name: /How Aadhaar eSign works/ })).toHaveAttribute(
      'href',
      '/docs/guides/aadhaar-leegality',
    );
  });

  it('says an eSign price is coming while none is set, and never how a price is made up', () => {
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
    const prices = within(section('aadhaar')).getByText('Free plan').closest('dl')!;
    expect(within(prices).getAllByText('Price coming soon')).toHaveLength(2);
    expect(prices.textContent).not.toContain('GST');
    expect(within(section('pricing')).getByText('Paying for Cloud opens shortly.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/markup|at cost|provider cost|\+ ?₹10/i);
  });

  it('lists the features teams ask for, Billing admin and workspace transfer among them', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const features = section('features');
    expect(
      within(features)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      'Templates',
      'Bulk send',
      'Reminders',
      'Signing order',
      'Your brand',
      'Workspaces',
      'Roles and Billing admin',
      'Workspace transfer',
    ]);
  });

  it('shows the audit trail as a real hash chain and links to the verify page', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const proof = section('proof');
    const entries = [...proof.querySelectorAll('figure ol > li')];
    expect(entries.map((li) => li.querySelector('code')?.textContent)).toEqual([
      'envelope.sent',
      'recipient.viewed',
      'recipient.authenticated',
      'recipient.signed',
      'envelope.completed',
    ]);
    expect(within(proof).getByText(/made-up people/)).toBeInTheDocument();
    expect(within(proof).getByRole('link', { name: 'Check a signed PDF' })).toHaveAttribute(
      'href',
      '/verify',
    );
  });

  it('shows the API with a working client call, and how to self-host', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const developers = section('developers');
    const code = within(developers).getByLabelText(
      'Sending an envelope with the TypeScript client',
    );
    expect(code.textContent).toContain("from '@codevibe_technology/sign-client'");
    expect(code.textContent).toContain('sign.envelopes.create(');
    for (const name of ['HTTP API', 'SDKs', 'Webhooks', 'Self-host']) {
      expect(within(developers).getByText(name)).toBeInTheDocument();
    }
    expect(
      within(developers).getByLabelText('Commands to self-host with Docker').textContent,
    ).toContain('docker compose up -d');
    expect(document.getElementById('open-source')).not.toBeNull();
  });

  it('prices the plans as cards from the prices it is given', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const pricing = section('pricing');
    expect(within(pricing).getAllByRole('article')).toHaveLength(3);
    expect(within(pricing).getByRole('article', { name: 'Cloud, recommended' })).toBeTruthy();
    expect(within(pricing).getByText('₹999')).toBeTruthy();
    expect(within(pricing).getByText('Pay for a year and save ₹1,998')).toBeTruthy();
    expect(within(pricing).getByText('₹35 per eSign')).toBeTruthy();
    expect(within(pricing).getByText('₹25 per eSign')).toBeTruthy();
    expect(within(pricing).getByRole('link', { name: 'Book installation help' })).toHaveAttribute(
      'href',
      '/install-help',
    );
    expect(within(pricing).getByText(/₹1,999 \+ GST/)).toBeTruthy();
    expect(within(pricing).getByText(/do not include 18% GST/)).toBeTruthy();
  });

  it('carries the hosting partner offer into the pricing', () => {
    render(
      <Landing
        features={FEATURES}
        pricing={{
          ...PRICING,
          hostingOffers: [
            {
              name: 'Hostinger VPS',
              url: 'https://www.hostinger.com/vps',
              note: 'Coupon CODEVIBE20: 20% off your first term',
            },
          ],
        }}
      />,
    );
    const pricing = section('pricing');
    expect(
      within(pricing).getByRole('link', { name: 'Hostinger VPS (opens in a new tab)' }),
    ).toHaveAttribute('href', 'https://www.hostinger.com/vps');
    expect(within(pricing).getByText('Coupon CODEVIBE20: 20% off your first term')).toBeTruthy();
  });

  it('answers the legal, Aadhaar, data and limit questions', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const faq = section('faq');
    expect(within(faq).getByText(/Information Technology Act, 2000/)).toBeTruthy();
    expect(within(faq).getByText('Is Aadhaar eSign available?')).toBeTruthy();
    expect(
      within(faq).getByText(/₹35 per eSign on the Free plan and\s+₹25 per eSign on Cloud/),
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
  });

  it('links the footer by column to the product, developers, company and legal pages', () => {
    render(<Landing features={FEATURES} pricing={PRICING} />);
    const footer = screen.getByRole('navigation', { name: 'Footer' });
    expect(
      within(footer)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['Product', 'Developers', 'Company', 'Legal']);
    const hrefs = within(footer)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/#how-it-works',
      '/#aadhaar',
      '/#pricing',
      '/verify',
      '/docs',
      '/docs/http-api/',
      '/docs/getting-started/docker',
      GITHUB,
      '/install-help',
      '/docs/guides/aadhaar-leegality',
      '/docs/security',
      'https://codevibe.in',
      '/terms',
      '/privacy',
    ]);
    for (const name of ['Docs', 'Verify a PDF', 'Terms', 'Privacy']) {
      expect(within(footer).getByRole('link', { name })).not.toHaveAttribute('target');
    }
  });

  it('keeps the public pages light whatever theme the app is in', () => {
    const { container } = render(<Landing features={FEATURES} pricing={PRICING} />);
    expect(container.firstElementChild).toHaveClass('marketing');
  });
});

describe('LegalPage', () => {
  it('shows the title, the date and the sections in the site shell', () => {
    const { container } = render(
      <LegalPage title="Privacy" updated="20 November 2026" intro={<p>Intro</p>}>
        <LegalSection title="What we store">
          <p>Names</p>
        </LegalSection>
      </LegalPage>,
    );
    expect(container.firstElementChild).toHaveClass('marketing');
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText('Last updated 20 November 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'What we store' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Site' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Site' })).getByRole('link', {
        name: 'Pricing',
      }),
    ).toHaveAttribute('href', '/#pricing');
  });
});
