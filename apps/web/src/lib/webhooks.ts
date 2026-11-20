import type { Tone } from './envelopes';

export const ALL_EVENTS = '*';
export const WEBHOOK_URL_MAX = 2000;
export const WEBHOOK_DESCRIPTION_MAX = 200;
/** Endpoints one workspace may have. */
export const MAX_WEBHOOKS = 20;
/** Deliveries are kept this long for the log. */
export const DELIVERY_RETENTION_DAYS = 30;

export interface WebhookEventInfo {
  value: string;
  label: string;
}

export const WEBHOOK_EVENT_GROUPS: { label: string; events: WebhookEventInfo[] }[] = [
  {
    label: 'Envelope',
    events: [
      { value: 'envelope.created', label: 'Created' },
      { value: 'envelope.updated', label: 'Draft edited' },
      { value: 'envelope.sent', label: 'Sent' },
      { value: 'envelope.completed', label: 'Completed' },
      { value: 'envelope.declined', label: 'Declined' },
      { value: 'envelope.expired', label: 'Expired' },
      { value: 'envelope.voided', label: 'Voided' },
    ],
  },
  {
    label: 'Recipient',
    events: [
      { value: 'recipient.notified', label: 'Invited' },
      { value: 'recipient.reminded', label: 'Reminded' },
      { value: 'recipient.viewed', label: 'Opened' },
      { value: 'recipient.authenticated', label: 'Verified identity' },
      { value: 'recipient.signed', label: 'Signed' },
      { value: 'recipient.approved', label: 'Approved' },
      { value: 'recipient.declined', label: 'Declined' },
    ],
  },
  {
    label: 'Document',
    events: [{ value: 'document.sealed', label: 'Sealed' }],
  },
];

export const WEBHOOK_EVENTS: string[] = WEBHOOK_EVENT_GROUPS.flatMap((g) =>
  g.events.map((e) => e.value),
);

export const DEFAULT_EVENTS = ['envelope.completed', 'envelope.declined', 'envelope.voided'];

export interface WebhookInput {
  url: string;
  description: string;
  events: string[];
}

/** Problems keyed by `url`, `description` or `events`; empty when the endpoint can be saved. */
export function webhookProblems(
  input: WebhookInput,
  options: { allowInsecure?: boolean } = {},
): Record<string, string> {
  const problems: Record<string, string> = {};
  const url = input.url.trim();
  if (!url) problems.url = 'Enter the URL that receives the events.';
  else if (url.length > WEBHOOK_URL_MAX) {
    problems.url = `Keep the URL under ${WEBHOOK_URL_MAX} characters.`;
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      problems.url = 'This is not a full URL. Start it with https://';
    }
    if (parsed) {
      if (parsed.protocol !== 'https:' && !(options.allowInsecure && parsed.protocol === 'http:')) {
        problems.url = 'Use an https:// URL, so events travel encrypted.';
      } else if (parsed.username || parsed.password) {
        problems.url =
          'Leave the user name and password out of the URL; the signature proves who sent it.';
      } else if (parsed.hash) {
        problems.url = 'Remove the # part; it is never sent.';
      }
    }
  }
  if (input.description.trim().length > WEBHOOK_DESCRIPTION_MAX) {
    problems.description = `Keep the description under ${WEBHOOK_DESCRIPTION_MAX} characters.`;
  }
  if (input.events.length === 0) problems.events = 'Pick at least one event, or all events.';
  else if (input.events.some((e) => e !== ALL_EVENTS && !WEBHOOK_EVENTS.includes(e))) {
    problems.events = 'One of the events is not known.';
  }
  return problems;
}

/** `*` alone when everything is picked; otherwise the picked events in a stable order. */
export function normalizeEvents(events: string[]): string[] {
  if (events.includes(ALL_EVENTS)) return [ALL_EVENTS];
  const picked = WEBHOOK_EVENTS.filter((e) => events.includes(e));
  return picked.length === WEBHOOK_EVENTS.length ? [ALL_EVENTS] : picked;
}

export function eventsSummary(events: string[]): string {
  if (events.includes(ALL_EVENTS)) return 'All events';
  if (events.length <= 2) return events.join(', ');
  return `${events.slice(0, 2).join(', ')} and ${events.length - 2} more`;
}

export type DeliveryStatus = 'delivered' | 'failed' | 'retrying' | 'skipped';

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  delivered: 'Delivered',
  failed: 'Failed',
  retrying: 'Retrying',
  skipped: 'Not sent',
};

export const DELIVERY_STATUS_TONES: Record<DeliveryStatus, Tone> = {
  delivered: 'success',
  failed: 'danger',
  retrying: 'warning',
  skipped: 'neutral',
};

/** How a delivery report reads in the log. */
export function deliveryStatus(report: {
  outcome: 'delivered' | 'failed' | 'skipped';
  retryAt: Date | string | null;
}): DeliveryStatus {
  if (report.outcome === 'failed') return report.retryAt ? 'retrying' : 'failed';
  return report.outcome;
}

/** The body indented for reading; left as it is when it is not JSON. */
export function prettyPayload(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** A short line on why a delivery did not go through and what to do. */
export function deliveryHint(delivery: {
  status: DeliveryStatus;
  responseStatus: number | null;
  error: string | null;
}): string | null {
  if (delivery.status === 'delivered') return null;
  if (delivery.status === 'skipped') {
    return 'The endpoint was turned off or removed before this went out.';
  }
  const code = delivery.responseStatus;
  if (code === 401 || code === 403) {
    return `Your server refused it (${code}). Check that it verifies the signature with the current secret.`;
  }
  if (code === 404) return 'Your server answered 404. Check the URL path.';
  if (code !== null && code >= 500) return `Your server failed (${code}). Check its logs.`;
  if (code !== null) return `Your server answered ${code}; only 2xx counts as received.`;
  if (delivery.error && /timeout|abort/i.test(delivery.error)) {
    return 'No answer within 10 seconds. Answer first, then do slow work.';
  }
  if (delivery.error && /address|resolve|ENOTFOUND|private|loopback/i.test(delivery.error)) {
    return 'The host could not be reached at a public address. Check the domain.';
  }
  return delivery.error;
}
