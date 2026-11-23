import { describe, expect, it } from 'vitest';
import { HOME_DESCRIPTION, jsonLdScript, softwareApplicationJsonLd } from './home-seo';

describe('softwareApplicationJsonLd', () => {
  const data = softwareApplicationJsonLd('https://sign.codevibe.in');

  it('describes the app with a free offer at its own address', () => {
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.url).toBe('https://sign.codevibe.in/');
    expect(data.offers).toMatchObject({ price: '0', priceCurrency: 'INR' });
    expect(data.description).toBe(HOME_DESCRIPTION);
  });

  it('claims no ratings, reviews or numbers it cannot back', () => {
    const json = JSON.stringify(data);
    for (const key of ['aggregateRating', 'review', 'ratingValue', 'userInteractionCount']) {
      expect(json).not.toContain(key);
    }
  });
});

describe('HOME_DESCRIPTION', () => {
  it('fits in a search result snippet', () => {
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
});

describe('jsonLdScript', () => {
  it('cannot close the script element it sits in', () => {
    expect(jsonLdScript({ text: '</script><script>alert(1)</script>' })).not.toContain('</');
  });
});
