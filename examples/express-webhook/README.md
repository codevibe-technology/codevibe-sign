# Webhook receiver

A plain `node:http` server that checks each delivery's `x-codevibe-signature` with
`readWebhook` from `@codevibe/sign-client`, skips deliveries it has already handled and logs
what happened to each envelope.

```sh
pnpm --filter example-express-webhook start
```

Point a server at `http://localhost:4000/webhooks/sign` with the same secret, for example
`WEBHOOK_URL=http://localhost:4000/webhooks/sign pnpm --filter example-node-embed start`.
Set `PORT` and `WEBHOOK_SECRET` to change the defaults.

The check needs the raw body. With Express, read it with `express.raw`:

```ts
import express from 'express';
import { readWebhook } from '@codevibe/sign-client';

const app = express();
app.post('/webhooks/sign', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const delivery = await readWebhook(secret, req.get('x-codevibe-signature'), req.body);
    // handle delivery.type and delivery.data.envelope
    res.sendStatus(204);
  } catch {
    res.sendStatus(400);
  }
});
```

Answer with a 2xx quickly. Anything else is retried with backoff, with the same delivery
`id`, so make your handling idempotent.
