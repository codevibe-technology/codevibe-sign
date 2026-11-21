// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CLOUD_PLAN_LIMITS, FREE_PLAN_LIMITS } from '@/lib/plans';
import { Landing } from './landing';
import { LegalPage, LegalSection } from './legal-page';

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

  it('has every section, reachable from the header', () => {
    render(<Landing free={FREE_PLAN_LIMITS} cloud={CLOUD_PLAN_LIMITS} />);
    for (const id of ['how-it-works', 'features', 'open-source', 'pricing', 'faq']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    const nav = screen.getByRole('navigation', { name: 'Site' });
    expect(within(nav).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/#pricing');
    expect(within(nav).getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
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
    expect(within(pricing).getByRole('link', { name: 'Talk to us' })).toHaveAttribute(
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
