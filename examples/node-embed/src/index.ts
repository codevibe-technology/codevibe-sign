import { randomBytes } from 'node:crypto';
import { createSignClient } from '@codevibe_technology/sign-client';
import {
  consoleOtpSender,
  createSignServer,
  listen,
  memoryFileStore,
  memoryStore,
  type SignServerOptions,
} from '@codevibe_technology/sign-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { samplePdf, selfSignedSeal } from './fixtures.ts';

const port = Number(process.env.PORT ?? 3000);
const signingPage = process.env.SIGNING_PAGE ?? 'http://localhost:5173';
const webhookUrl = process.env.WEBHOOK_URL;
const apiKey = process.env.SIGN_API_KEY ?? randomBytes(24).toString('base64url');
// The docs site, its local preview and the published docs may call this server from a browser.
const corsOrigins = (
  process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173,https://sign.codevibe.in'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Prints the signing links instead of mailing them. Use smtpMailer() for real mail.
const mailer: SignServerOptions['mailer'] = {
  async send(mail) {
    const link = mail.text.match(/\S+\?token=\S+/)?.[0];
    console.log(
      link ? `Signing link for ${mail.to}: ${link}` : `Mail to ${mail.to}: ${mail.subject}`,
    );
  },
};

const sign = createSignServer({
  store: memoryStore(),
  files: memoryFileStore(),
  mailer,
  otp: consoleOtpSender(),
  sealer: { p12: selfSignedSeal('example'), passphrase: 'example' },
  apiKeys: [apiKey],
  publicUrl: `http://localhost:${port}`,
  signingUrl: (token) => `${signingPage}/?token=${token}`,
  webhooks: webhookUrl
    ? [
        {
          url: webhookUrl,
          secret: process.env.WEBHOOK_SECRET ?? 'example-webhook-secret',
          events: ['*'],
        },
      ]
    : [],
  // The example posts webhooks to a receiver on this machine; production keeps the defaults.
  webhookSecurity: { allowInsecure: true },
});

// The server sends no CORS headers; this wrapper adds them for the origins above only.
const app = new Hono();
app.use('*', async (c, next) => {
  // Lets a public page such as the published docs reach this server on localhost.
  if (c.req.header('access-control-request-private-network') === 'true') {
    c.header('Access-Control-Allow-Private-Network', 'true');
  }
  await next();
});
app.use(
  '*',
  cors({
    origin: corsOrigins,
    allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Sign-Session'],
    exposeHeaders: ['Retry-After', 'Idempotent-Replayed', 'Content-Disposition', 'ETag'],
    maxAge: 600,
  }),
);
app.all('*', (c) => sign.app.fetch(c.req.raw, c.env));
await listen(app, { port });
setInterval(() => void sign.tick(), 60_000);

const client = createSignClient({ baseUrl: `http://localhost:${port}`, apiKey });
const envelope = await client.envelopes.create({
  title: 'Offer letter',
  send: true,
  documents: [{ name: 'offer.pdf', content: await samplePdf() }],
  recipients: [
    { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
    { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', auth: 'email_link' },
  ],
  fields: [
    { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 640, width: 200, height: 50 },
    { recipient: 'ravi', type: 'signature', page: 0, x: 320, y: 640, width: 200, height: 50 },
  ],
});

console.log(`API key: ${apiKey}`);
console.log(`Server on http://localhost:${port}, envelope ${envelope.id} sent.`);
console.log(`CORS allowed for ${corsOrigins.join(', ')}`);
console.log('Asha signs first and her one-time code is printed here; Ravi gets his link after.');
console.log(
  `Once signed: curl -H "Authorization: Bearer ${apiKey}" -o signed.pdf ` +
    `http://localhost:${port}/v1/envelopes/${envelope.id}/documents/${envelope.documents[0]!.id}`,
);
