import type { CheckoutSession } from '@/server/billing/orders';

export interface CheckoutPayment {
  orderId: string;
  paymentId: string;
  signature: string;
}

interface RazorpayResponse {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string };
  handler: (response: RazorpayResponse) => void;
  modal: { ondismiss: () => void };
}

type RazorpayConstructor = new (options: RazorpayOptions) => { open: () => void };

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
const LOAD_FAILED =
  'The payment window could not be loaded. Check your connection, turn off any content blocker for this page and try again.';

let loading: Promise<RazorpayConstructor> | undefined;

const razorpayOf = () => (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;

function loadCheckout(): Promise<RazorpayConstructor> {
  const ready = razorpayOf();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => {
      const loaded = razorpayOf();
      if (loaded) resolve(loaded);
      else reject(new Error(LOAD_FAILED));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(LOAD_FAILED));
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/**
 * Opens Razorpay Checkout for an order made on the server. Resolves with what Razorpay
 * handed back, which the server must still confirm, or null when the window was closed.
 */
export async function openCheckout(session: CheckoutSession): Promise<CheckoutPayment | null> {
  const Razorpay = await loadCheckout();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payment: CheckoutPayment | null) => {
      if (settled) return;
      settled = true;
      resolve(payment);
    };
    new Razorpay({
      key: session.keyId,
      order_id: session.orderId,
      amount: session.amountPaise,
      currency: session.currency,
      name: session.name,
      description: session.description,
      prefill: session.prefill,
      handler: (response) => {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = response;
        finish(
          razorpay_order_id && razorpay_payment_id && razorpay_signature
            ? {
                orderId: razorpay_order_id,
                paymentId: razorpay_payment_id,
                signature: razorpay_signature,
              }
            : null,
        );
      },
      modal: { ondismiss: () => finish(null) },
    }).open();
  });
}
