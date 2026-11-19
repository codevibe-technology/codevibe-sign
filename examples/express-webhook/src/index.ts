import { createServer } from 'node:http';
import {
  readWebhook,
  SIGNATURE_HEADER,
  type WebhookDelivery,
} from '@codevibe_technology/sign-client';

const port = Number(process.env.PORT ?? 4000);
const secret = process.env.WEBHOOK_SECRET ?? 'example-webhook-secret';
// Failed deliveries are retried with the same id; a real app keeps this in its database.
const handled = new Set<string>();

function handle(delivery: WebhookDelivery) {
  const { envelope } = delivery.data;
  switch (delivery.type) {
    case 'envelope.completed':
      console.log(`Signed: "${envelope.title}" (${envelope.id}). Download the sealed PDF now.`);
      break;
    case 'envelope.declined':
    case 'envelope.voided':
    case 'envelope.expired':
      console.log(`Stopped: "${envelope.title}" is ${envelope.status}.`);
      break;
    default:
      console.log(`${delivery.type} on "${envelope.title}"`);
  }
}

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/sign') {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let delivery: WebhookDelivery;
  try {
    delivery = await readWebhook(secret, req.headers[SIGNATURE_HEADER], Buffer.concat(chunks));
  } catch {
    res.writeHead(400).end('Invalid signature');
    return;
  }
  if (!handled.has(delivery.id)) {
    handled.add(delivery.id);
    handle(delivery);
  }
  res.writeHead(204).end();
}).listen(port, () => {
  console.log(`Waiting for webhooks on http://localhost:${port}/webhooks/sign`);
});
