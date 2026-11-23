import { describe, expect, it } from 'vitest';
import { billingConfig } from './config';
import { pricingView } from './pricing';

describe('pricingView', () => {
  it('works out what a year saves from the price and the months a year costs', () => {
    const view = pricingView(billingConfig({ CLOUD_PRICE_INR: '999', CLOUD_ANNUAL_MONTHS: '10' }));
    expect(view.cloudMonth).toBe('₹999');
    expect(view.cloudYear).toBe('₹9,990');
    expect(view.yearSaving).toBe('2 months free');
    expect(view.yearSavingAmount).toBe('₹1,998');
  });

  it('follows a changed price and term', () => {
    const view = pricingView(billingConfig({ CLOUD_PRICE_INR: '1499', CLOUD_ANNUAL_MONTHS: '11' }));
    expect(view.cloudYear).toBe('₹16,489');
    expect(view.yearSaving).toBe('1 month free');
    expect(view.yearSavingAmount).toBe('₹1,499');
  });

  it('claims no saving when a year costs twelve months', () => {
    const view = pricingView(billingConfig({ CLOUD_ANNUAL_MONTHS: '12' }));
    expect(view.yearSaving).toBeNull();
    expect(view.yearSavingAmount).toBeNull();
  });
});
