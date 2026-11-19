import { createSignClient } from '@codevibe_technology/sign-client';
import {
  consoleOtpSender,
  createSignServer,
  listen,
  memoryFileStore,
  memoryStore,
  type SignServerOptions,
} from '@codevibe_technology/sign-server';
import { samplePdf, selfSignedSeal } from './fixtures.ts';

const port = Number(process.env.PORT ?? 3000);
const signingPage = process.env.SIGNING_PAGE ?? 'http://localhost:5173';
const webhookUrl = process.env.WEBHOOK_URL;
const apiKey = process.env.SIGN_API_KEY ?? 'example-api-key-change-me';

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
await listen(sign.app, { port });
setInterval(() => void sign.tick(), 60_000);

const client = createSignClient({ baseUrl: `http://localhost:${port}`, apiKey });
const envelope = await client.envelopes.create({
  title: 'Offer letter',
  send: true,
  documents: [{ name: 'offer.pdf', content: await samplePdf() }],
  recipients: [
    { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
    { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com' },
  ],
  fields: [
    { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 640, width: 200, height: 50 },
    { recipient: 'ravi', type: 'signature', page: 0, x: 320, y: 640, width: 200, height: 50 },
  ],
});

console.log(`Server on http://localhost:${port}, envelope ${envelope.id} sent.`);
console.log('Asha signs first and her one-time code is printed here; Ravi gets his link after.');
console.log(
  `Once signed: curl -H "Authorization: Bearer ${apiKey}" -o signed.pdf ` +
    `http://localhost:${port}/v1/envelopes/${envelope.id}/documents/${envelope.documents[0]!.id}`,
);
