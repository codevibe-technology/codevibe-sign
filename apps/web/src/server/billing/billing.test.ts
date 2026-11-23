import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CREDITS_UNAVAILABLE_MESSAGES,
  billingConfig,
  creditsOffer,
  esignPrice,
  paymentsConfigured,
  platformLeegality,
  billingMode,
} from './config';
import { creditsLine } from './credit-orders';
import {
  RazorpayError,
  createRazorpay,
  isRazorpayId,
  parseWebhook,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from './razorpay';
import { openSecret, sealSecret } from './secret-box';

const SELLER = {
  INVOICE_SELLER_NAME: 'Codevibe Technology Private Limited',
  INVOICE_SELLER_GSTIN: '06AANCC6406C1ZX',
  INVOICE_SELLER_CIN: 'U62099HR2026PTC142917',
  INVOICE_SELLER_ADDRESS: '3rd Floor, Tower A 309, SAS Tower, Gurugram, Haryana 122001',
};
const RAZORPAY = { RAZORPAY_KEY_ID: 'rzp_test_abc123', RAZORPAY_KEY_SECRET: 'secret-value' };
const LEEGALITY = {
  LEEGALITY_API_KEY: 'token',
  LEEGALITY_PRIVATE_SALT: 'salt',
  LEEGALITY_WORKFLOW_ID: 'wf_1',
};

describe('billingConfig', () => {
  it('has nothing to sell on an install that sets nothing, and does not throw', () => {
    const config = billingConfig({});
    expect(config).toMatchObject({
      razorpay: null,
      seller: null,
      leegality: null,
      gstPercent: 18,
      sac: '998319',
      series: 'CV-{FY}',
      creditNoteSeries: 'CVCN-{FY}',
      proformaSeries: 'CVPI-{FY}',
      live: false,
      problems: [],
      esign: { providerCostPaise: null, markupPaise: 1000, packs: [10, 50, 200] },
      cloud: {
        pricePaise: 99_900,
        includedMembers: 25,
        extraMemberPaise: 9900,
        annualMonths: 10,
        graceDays: 7,
      },
      installHelpPaise: 199_900,
      operatorEmail: null,
      hostingOffers: [],
    });
    expect(paymentsConfigured(config)).toBe(false);
    expect(platformLeegality({})).toBeNull();
  });

  it('reads a full configuration', () => {
    const config = billingConfig({
      ...SELLER,
      ...RAZORPAY,
      ...LEEGALITY,
      RAZORPAY_WEBHOOK_SECRET: 'whsec',
      LEEGALITY_BASE_URL: 'https://app1.leegality.com/api',
      ESIGN_PROVIDER_COST_INR: '24.50',
      ESIGN_MARKUP_INR: '10',
      CREDIT_PACKS: '200, 10,50,10',
      INVOICE_SERIES: 'CV/{FY}/',
      HOSTING_OFFERS: '[{"name":"Example Host","url":"https://example.com/ref"}]',
      OPERATOR_EMAIL: 'owner@example.com',
    });
    expect(paymentsConfigured(config)).toBe(true);
    expect(config.razorpay).toMatchObject({ mode: 'test', webhookSecret: 'whsec' });
    expect(config.seller).toMatchObject({ stateCode: '06', cin: 'U62099HR2026PTC142917' });
    expect(config.esign).toEqual({
      providerCostPaise: 2450,
      markupPaise: 1000,
      packs: [10, 50, 200],
    });
    expect(config.leegality).toMatchObject({ environment: 'production', webhookHeader: null });
    expect(config.hostingOffers).toEqual([
      { name: 'Example Host', url: 'https://example.com/ref' },
    ]);
  });

  it.each([
    [{ RAZORPAY_KEY_ID: 'rzp_test_abc' }, /RAZORPAY_KEY_SECRET must be set/],
    [{ ...RAZORPAY, RAZORPAY_KEY_ID: 'key_123' }, /RAZORPAY_KEY_ID must look like/],
    [{ INVOICE_SELLER_NAME: 'X' }, /INVOICE_SELLER_GSTIN, INVOICE_SELLER_ADDRESS must be set/],
    [{ ...SELLER, INVOICE_SELLER_GSTIN: '06AANCC6406C1ZY' }, /INVOICE_SELLER_GSTIN does not pass/],
    [{ ESIGN_PROVIDER_COST_INR: 'twenty' }, /ESIGN_PROVIDER_COST_INR must be an amount/],
    [{ ESIGN_MARKUP_INR: '-5' }, /ESIGN_MARKUP_INR must be an amount/],
    [{ CREDIT_PACKS: '10,many' }, /CREDIT_PACKS must be/],
    [{ CREDIT_PACKS: '0' }, /CREDIT_PACKS must be/],
    [{ GST_PERCENT: 'eighteen' }, /GST_PERCENT must be/],
    [{ INVOICE_SERIES: 'CODEVIBE-SIGN-{FY}-' }, /INVOICE_SERIES makes invoice numbers longer/],
    [{ INVOICE_SAC: '99' }, /INVOICE_SAC must be/],
    [{ CLOUD_ANNUAL_MONTHS: '13' }, /CLOUD_ANNUAL_MONTHS must be a whole number from 1 to 12/],
    [{ CLOUD_PRICE_INR: 'free' }, /CLOUD_PRICE_INR must be an amount/],
    [{ HOSTING_OFFERS: '{' }, /HOSTING_OFFERS must be a JSON list/],
    [{ HOSTING_OFFERS: '[{"name":"x","url":"http://x.example"}]' }, /https links/],
    [
      { ...LEEGALITY, LEEGALITY_BASE_URL: 'http://app1.leegality.com/api' },
      /LEEGALITY_BASE_URL must be/,
    ],
    [{ BILLING_LIVE: 'yes' }, /BILLING_LIVE must be true or false/],
    [{ ...SELLER, INVOICE_UPI_ID: 'not a upi' }, /INVOICE_UPI_ID must be/],
    [{ ...SELLER, INVOICE_BANK_NAME: 'Bank' }, /INVOICE_BANK_HOLDER, INVOICE_BANK_ACCOUNT/],
    [{ LEEGALITY_API_KEY: 't' }, /LEEGALITY_PRIVATE_SALT, LEEGALITY_WORKFLOW_ID must be set/],
    [{ OPERATOR_EMAIL: 'owner' }, /OPERATOR_EMAIL must be an email/],
  ])('names the variable for %j', (source, message) => {
    expect(() => billingConfig(source)).toThrow(message);
  });

  it('never repeats a secret in an error', () => {
    const attempt = () =>
      billingConfig({ ...RAZORPAY, RAZORPAY_KEY_ID: 'bad', RAZORPAY_KEY_SECRET: 'hunter2hunter2' });
    expect(attempt).toThrow();
    try {
      attempt();
    } catch (err) {
      expect(String(err)).not.toContain('hunter2');
    }
  });
});

describe('billing mode', () => {
  const live = 'https://app1.leegality.com/api';

  it('reports test keys and the sandbox while the install is not live', () => {
    const config = billingConfig({ ...SELLER, ...RAZORPAY, ...LEEGALITY });
    expect(billingMode(config)).toEqual({
      razorpay: 'test',
      leegality: 'sandbox',
      live: false,
      problems: [],
    });
    expect(config.leegality).toMatchObject({
      environment: 'sandbox',
      baseUrl: 'https://sandbox.leegality.com/api',
    });
    expect(creditsOffer(config, 'free').testMode).toBe(true);
  });

  it('refuses test keys and the sandbox once BILLING_LIVE is on, without throwing', () => {
    const config = billingConfig({ ...SELLER, ...RAZORPAY, ...LEEGALITY, BILLING_LIVE: 'true' });
    expect(config.razorpay).toBeNull();
    expect(config.leegality).toBeNull();
    expect(paymentsConfigured(config)).toBe(false);
    const mode = billingMode(config);
    expect(mode).toMatchObject({ razorpay: 'test', leegality: 'sandbox', live: true });
    expect(mode.problems).toHaveLength(2);
    expect(mode.problems.join(' ')).toMatch(/RAZORPAY_KEY_ID is a test key/);
    expect(mode.problems.join(' ')).toMatch(/LEEGALITY_BASE_URL is the sandbox/);
    expect(JSON.stringify(mode)).not.toContain('secret-value');
  });

  it('accepts live keys and the production URL when live', () => {
    const config = billingConfig({
      ...SELLER,
      ...LEEGALITY,
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      RAZORPAY_KEY_SECRET: 'secret-value',
      LEEGALITY_BASE_URL: `${live}/`,
      BILLING_LIVE: 'true',
    });
    expect(billingMode(config)).toEqual({
      razorpay: 'live',
      leegality: 'production',
      live: true,
      problems: [],
    });
    expect(config.leegality?.baseUrl).toBe(live);
    expect(creditsOffer(config, 'free').testMode).toBe(false);
  });

  it('reads the seller details printed on invoices', () => {
    const { seller } = billingConfig({
      ...SELLER,
      INVOICE_SELLER_PHONE: '+91 70000 00000',
      INVOICE_UPI_ID: 'shop@bank',
      INVOICE_BANK_NAME: 'Bank',
      INVOICE_BANK_HOLDER: 'Holder',
      INVOICE_BANK_ACCOUNT: '123456',
      INVOICE_BANK_IFSC: 'idfb0021003',
    });
    expect(seller).toMatchObject({
      pan: 'AANCC6406C',
      phone: '+91 70000 00000',
      upiId: 'shop@bank',
      bank: { name: 'Bank', holder: 'Holder', account: '123456', ifsc: 'IDFB0021003' },
    });
  });
});

describe('eSign price', () => {
  const config = billingConfig({ ESIGN_PROVIDER_COST_INR: '25', ESIGN_MARKUP_INR: '10' });

  it('depends on the plan', () => {
    expect(esignPrice(config, 'free')).toEqual({ pricePaise: 3500 });
    expect(esignPrice(config, 'cloud')).toEqual({ pricePaise: 2500 });
    expect(esignPrice(config, 'unlimited')).toEqual({ pricePaise: 2500 });
  });

  it('is unknown until the operator sets it', () => {
    expect(esignPrice(billingConfig({}), 'free')).toBeNull();
    expect(
      creditsOffer(billingConfig({ ...SELLER, ...RAZORPAY, ...LEEGALITY }), 'free'),
    ).toMatchObject({
      unavailable: 'price_not_set',
      pricePaise: null,
    });
  });

  it('says why credits cannot be bought, in order', () => {
    const cost = { ESIGN_PROVIDER_COST_INR: '25' };
    expect(creditsOffer(billingConfig(cost), 'free').unavailable).toBe('payments_not_configured');
    expect(creditsOffer(billingConfig({ ...cost, ...RAZORPAY }), 'free').unavailable).toBe(
      'payments_not_configured',
    );
    expect(
      creditsOffer(billingConfig({ ...cost, ...RAZORPAY, ...SELLER }), 'free').unavailable,
    ).toBe('esign_not_configured');
    const ready = billingConfig({ ...cost, ...RAZORPAY, ...SELLER, ...LEEGALITY });
    expect(creditsOffer(ready, 'free')).toEqual({
      unavailable: null,
      pricePaise: 3500,
      packs: [10, 50, 200],
      gstPercent: 18,
      testMode: true,
    });
  });

  it('refuses test payments for the production eSign account', () => {
    const base = {
      ESIGN_PROVIDER_COST_INR: '25',
      ...SELLER,
      ...LEEGALITY,
      LEEGALITY_BASE_URL: 'https://app1.leegality.com/api',
    };
    expect(creditsOffer(billingConfig({ ...base, ...RAZORPAY }), 'cloud').unavailable).toBe(
      'test_payments',
    );
    const live = { ...RAZORPAY, RAZORPAY_KEY_ID: 'rzp_live_abc123' };
    expect(creditsOffer(billingConfig({ ...base, ...live }), 'cloud')).toMatchObject({
      unavailable: null,
      testMode: false,
    });
  });

  it('never tells a customer how the price is made up', () => {
    const texts = [...Object.values(CREDITS_UNAVAILABLE_MESSAGES), creditsLine(50, 3500)];
    for (const text of texts) {
      expect(text).not.toMatch(/cost|markup|margin|leegality|provider|\+/i);
    }
    expect(creditsLine(50, 3500)).toBe('Aadhaar eSign credits × 50 @ ₹35');
    expect(creditsLine(10, 2450)).toBe('Aadhaar eSign credits × 10 @ ₹24.50');
  });
});

describe('secret box', () => {
  const source = { AUTH_SECRET: 'a'.repeat(40) };

  it('round trips and never stores the plain text', () => {
    const sealed = sealSecret('tok_live_123', 'ws_1:leegality.authToken', source);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('tok_live_123');
    expect(openSecret(sealed, 'ws_1:leegality.authToken', source)).toBe('tok_live_123');
    expect(sealSecret('tok_live_123', 'ws_1:leegality.authToken', source)).not.toBe(sealed);
  });

  it('does not open for another context, another key or after a change', () => {
    const sealed = sealSecret('s3cret', 'ws_1:salt', source);
    expect(() => openSecret(sealed, 'ws_2:salt', source)).toThrow(/could not be opened/);
    expect(() => openSecret(sealed, 'ws_1:salt', { AUTH_SECRET: 'b'.repeat(40) })).toThrow();
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3]!, 'base64url');
    body[0] = body[0]! ^ 1;
    const tampered = [...parts.slice(0, 3), body.toString('base64url')].join('.');
    expect(() => openSecret(tampered, 'ws_1:salt', source)).toThrow(/could not be opened/);
    expect(() => openSecret('plain text', 'ws_1:salt', source)).toThrow(/known format/);
  });

  it('prefers SECRETS_KEY and insists on its length', () => {
    const own = { ...source, SECRETS_KEY: 'k'.repeat(32) };
    const sealed = sealSecret('x', 'c', own);
    expect(openSecret(sealed, 'c', own)).toBe('x');
    expect(() => openSecret(sealed, 'c', source)).toThrow();
    expect(() => sealSecret('x', 'c', { ...source, SECRETS_KEY: 'short' })).toThrow(/SECRETS_KEY/);
    expect(() => sealSecret('x', 'c', {})).toThrow(/AUTH_SECRET/);
  });
});

describe('Razorpay signatures', () => {
  it('accepts the checkout signature Razorpay documents', () => {
    const secret = 'EnLs21M47BllR3X8PSFtjtbd';
    const signature = createHmac('sha256', secret)
      .update('order_IEIaMR65cu6nz3|pay_IH4NVgf4Dreq1l')
      .digest('hex');
    const input = { orderId: 'order_IEIaMR65cu6nz3', paymentId: 'pay_IH4NVgf4Dreq1l', signature };
    expect(verifyCheckoutSignature(input, secret)).toBe(true);
    expect(verifyCheckoutSignature({ ...input, paymentId: 'pay_IH4NVgf4Dreq1m' }, secret)).toBe(
      false,
    );
    expect(verifyCheckoutSignature(input, 'another-secret')).toBe(false);
    expect(verifyCheckoutSignature({ ...input, signature: 'zz' }, secret)).toBe(false);
    expect(verifyCheckoutSignature({ ...input, signature: '' }, secret)).toBe(false);
  });

  it('matches a known HMAC-SHA256 vector', () => {
    // RFC 4231 test case 2.
    expect(
      verifyWebhookSignature(
        'what do ya want for nothing?',
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
        'Jefe',
      ),
    ).toBe(true);
  });

  it('checks the webhook signature over the raw body', () => {
    const body = '{"event":"payment.captured"}';
    const signature = createHmac('sha256', 'whsec').update(body).digest('hex');
    expect(verifyWebhookSignature(body, signature, 'whsec')).toBe(true);
    expect(verifyWebhookSignature(`${body} `, signature, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, signature.toUpperCase(), 'whsec')).toBe(true);
    expect(verifyWebhookSignature(body, signature.slice(2), 'whsec')).toBe(false);
  });

  it('reads the payment out of a webhook', () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_ABC123456',
            order_id: 'order_XYZ98765',
            amount: 41_300,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    });
    expect(parseWebhook(body)).toEqual({
      event: 'payment.captured',
      orderId: 'order_XYZ98765',
      payment: {
        id: 'pay_ABC123456',
        orderId: 'order_XYZ98765',
        amount: 41_300,
        currency: 'INR',
        status: 'captured',
      },
    });
    expect(parseWebhook('not json')).toBeNull();
    expect(parseWebhook('[]')).toBeNull();
    expect(parseWebhook('{"event":"refund.created","payload":{}}')).toEqual({
      event: 'refund.created',
      payment: null,
      orderId: null,
    });
    expect(
      parseWebhook(
        '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"../x","amount":1}}}}',
      )?.payment,
    ).toBeNull();
  });

  it('only lets plain ids through', () => {
    expect(isRazorpayId('pay_IH4NVgf4Dreq1l')).toBe(true);
    for (const bad of ['', 'pay', 'pay_/../x', 'pay_1 2', 42, null]) {
      expect(isRazorpayId(bad)).toBe(false);
    }
  });
});

describe('Razorpay client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('creates an order with basic auth and the amount in paise', async () => {
    const fetch = vi.fn(async () =>
      json({ id: 'order_ABC12345', amount: 41_300, currency: 'INR', status: 'created' }),
    );
    const client = createRazorpay({ keyId: 'rzp_test_k', keySecret: 's3cret', fetch });
    const order = await client.createOrder({ amountPaise: 41_300, receipt: 'ord_1' });
    expect(order).toEqual({
      id: 'order_ABC12345',
      amount: 41_300,
      currency: 'INR',
      status: 'created',
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('rzp_test_k:s3cret').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: 41_300,
      currency: 'INR',
      receipt: 'ord_1',
    });
  });

  it('refuses an order answer for another amount', async () => {
    const fetch = async () => json({ id: 'order_ABC12345', amount: 100, currency: 'INR' });
    const client = createRazorpay({ keyId: 'rzp_test_k', keySecret: 's', fetch });
    await expect(client.createOrder({ amountPaise: 41_300, receipt: 'r' })).rejects.toThrow(
      /unexpected answer/,
    );
  });

  it('reports failures without the key or the response body', async () => {
    const fetch = async () => json({ error: { description: 'key s3cret-value is wrong' } }, 401);
    const client = createRazorpay({ keyId: 'rzp_test_k', keySecret: 's3cret-value', fetch });
    const err = await client.fetchPayment('pay_ABC123456').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RazorpayError);
    expect((err as RazorpayError).status).toBe(401);
    expect((err as RazorpayError).retryable).toBe(false);
    expect(String(err)).not.toContain('s3cret-value');
  });

  it('marks network failures and server errors as retryable', async () => {
    const down = createRazorpay({
      keyId: 'k',
      keySecret: 's',
      fetch: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(await down.fetchPayment('pay_ABC123456').catch((e: RazorpayError) => e.retryable)).toBe(
      true,
    );
    const busy = createRazorpay({ keyId: 'k', keySecret: 's', fetch: async () => json({}, 503) });
    expect(await busy.fetchPayment('pay_ABC123456').catch((e: RazorpayError) => e.retryable)).toBe(
      true,
    );
  });

  it('never puts an odd id in a URL', async () => {
    const fetch = vi.fn(async () => json({}));
    const client = createRazorpay({ keyId: 'k', keySecret: 's', fetch });
    await expect(client.fetchPayment('pay_1/../../orders')).rejects.toThrow();
    await expect(client.capturePayment('x y', 100)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
