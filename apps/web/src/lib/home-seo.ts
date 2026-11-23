export const HOME_TITLE = 'Codevibe Sign: send documents for signature in minutes';
export const HOME_DESCRIPTION =
  'Open-source e-signatures: send a PDF, people sign on any device, and you get a sealed PDF with a certificate anyone can verify. Free plan or self-host.';

/**
 * Structured data for the home page: what the product is and that the cloud plan starts free.
 * Only facts; no ratings, reviews or counts.
 */
export function softwareApplicationJsonLd(appUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Codevibe Sign',
    url: `${appUrl}/`,
    description: HOME_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    isAccessibleForFree: true,
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'INR',
      description: 'Free plan: a cloud workspace for Rs 0',
    },
    featureList: [
      'Send PDFs for signature',
      'One-time email codes for signers',
      'PAdES-sealed PDF with a signing certificate',
      'Hash-chained audit trail',
      'Public verify page',
      'Templates and bulk send from CSV',
      'HTTP API and signed webhooks',
      'Aadhaar eSign through Leegality',
    ],
    publisher: { '@type': 'Organization', name: 'Codevibe Technology', url: 'https://codevibe.in' },
  };
}

/** JSON for a `<script type="application/ld+json">`, safe to place inside HTML. */
export const jsonLdScript = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
