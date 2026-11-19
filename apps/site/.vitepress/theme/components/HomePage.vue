<script setup lang="ts">
import HeroFlow from './HeroFlow.vue';
import { CODEVIBE_URL, GITHUB_URL, HRVIBE_URL } from '../../site';

const steps = [
  {
    title: 'Send',
    text: 'Upload a PDF, add the people who need to sign and place their fields. Each person gets a private link that expires.',
  },
  {
    title: 'Sign in order',
    text: 'Signers act one after another, or all at once. Each can confirm a one-time code by email or SMS before signing.',
  },
  {
    title: 'Seal',
    text: 'After the last signature, the values are drawn onto the pages, a certificate page is added and the file is sealed with your certificate.',
  },
  {
    title: 'Verify',
    text: 'Anyone with the file can check the seal and the audit trail offline, without asking the server that produced it.',
  },
];

const features = [
  {
    title: 'Signing order',
    text: 'Sequential or parallel routing. People with the same order sign together. Reminders and expiry are built in.',
  },
  {
    title: 'One-time codes',
    text: 'Email or SMS codes: six digits, valid for ten minutes, locked after five wrong tries and rate limited.',
  },
  {
    title: 'Tamper-evident audit trail',
    text: 'Every action is appended to a log chained with SHA-256. The chain head is printed on the certificate page.',
  },
  {
    title: 'PAdES seal',
    text: 'The final PDF carries a PAdES signature made with your certificate. Any later edit shows up in Adobe Reader.',
  },
  {
    title: 'Aadhaar eSign',
    text: 'For documents that need a statutory signature in India, through your own account with a licensed provider.',
  },
  {
    title: 'React components',
    text: 'A signature pad, a signing view and field placement. Unstyled, and themed with CSS variables.',
  },
  {
    title: 'Self-host with Docker',
    text: 'One image configured with environment variables, PostgreSQL and your mail server. Documents stay with you.',
  },
  {
    title: 'Apache-2.0',
    text: 'Use it in commercial products, change it and read every line. No usage limits and no account with us.',
  },
];

const faqs = [
  {
    q: 'Is it free?',
    a: 'Yes. The code is Apache-2.0. You pay only for what you run it on: your server, your mail and SMS delivery, and eSign credits with your provider if you use Aadhaar eSign.',
  },
  {
    q: 'Can I use it in production today?',
    a: 'Not yet. The project is pre-release and the APIs may change before 0.1. The core rules and the Aadhaar adapter are done; PDF sealing, the server and the React components are being built now.',
  },
  {
    q: 'Do my documents leave my servers?',
    a: 'No. You run the service, so documents, keys and personal data stay in your infrastructure. The one exception is Aadhaar eSign, where the document goes to the eSign provider you chose.',
  },
  {
    q: 'Is a signature made with it legally valid?',
    a: 'In India, an agreement signed electronically is generally enforceable, and the audit trail is the evidence. Some documents need a statutory electronic signature such as Aadhaar eSign, and a few cannot be signed electronically at all. See the legal page, and take your own advice.',
  },
  {
    q: 'What certificate do I need to seal files?',
    a: 'A PKCS#12 file with a certificate and key. It identifies you as the operator, not the signer. A self-signed certificate works for testing; for files other people will open in Adobe Reader, use one from a trusted issuer.',
  },
  {
    q: 'Does Codevibe sell Aadhaar eSign?',
    a: 'No. You open an account with a provider such as Leegality, buy credits from them and give the package your API keys. Each eSign is billed to you by the provider.',
  },
  {
    q: 'Can I build a commercial product on it?',
    a: 'Yes. The licence allows it. The licence does not cover the Codevibe names and logos, so please do not call your product or hosted service "Codevibe Sign".',
  },
  {
    q: 'Which stack does it need?',
    a: 'Node 20 or later and PostgreSQL for the server. Your own backend can be in any language, since it talks to the server over HTTP. The UI components are for React.',
  },
];
</script>

<template>
  <div class="home">
    <section class="hero">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <p class="eyebrow">Open source · Apache-2.0 · Pre-release</p>
          <h1>E-signatures you run on your own servers</h1>
          <p class="lead">
            Send a PDF, collect signatures in the order you choose and get back one sealed file with
            an audit trail anyone can check. Embed the TypeScript packages in your product, or run
            the service with Docker.
          </p>
          <div class="actions">
            <a class="btn btn-primary" href="/getting-started/">Get started</a>
            <a class="btn btn-ghost" :href="GITHUB_URL" target="_blank" rel="noopener">
              View on GitHub
            </a>
          </div>
        </div>
        <div class="hero-art">
          <HeroFlow />
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="how">
      <div class="wrap">
        <h2 id="how">How it works</h2>
        <p class="section-lead">Four steps, from the first invitation to a file you can prove.</p>
        <ol class="steps">
          <li v-for="(step, i) in steps" :key="step.title" class="card step-card">
            <span class="num">{{ i + 1 }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.text }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section class="section alt" aria-labelledby="features">
      <div class="wrap">
        <h2 id="features">What you get</h2>
        <p class="section-lead">
          Small packages with clear jobs. Use the whole service, or only the parts you need.
        </p>
        <ul class="features">
          <li v-for="f in features" :key="f.title" class="card">
            <h3>{{ f.title }}</h3>
            <p>{{ f.text }}</p>
          </li>
        </ul>
      </div>
    </section>

    <section class="section" aria-labelledby="code">
      <div class="wrap code-grid">
        <div>
          <h2 id="code">Embed it in your backend</h2>
          <p class="section-lead">
            Start the server inside your own Node app, then create and send envelopes over its HTTP
            API with an API key.
          </p>
          <p class="note">
            <span class="badge">Pre-release</span>
            The server package is still being built. This is the planned API and it may change
            before 0.1.
          </p>
          <a class="text-link" href="/getting-started/node">Read the Node guide</a>
        </div>
        <div class="code-box">
          <slot name="code" />
        </div>
      </div>
    </section>

    <section class="band" aria-labelledby="built-by">
      <div class="wrap band-grid">
        <div>
          <h2 id="built-by">Built by Codevibe</h2>
          <p>
            Codevibe Sign is made and maintained by
            <a :href="CODEVIBE_URL" target="_blank" rel="noopener">Codevibe</a>, and it is the
            signing layer in our own products. The code, the issues and the roadmap are public.
          </p>
        </div>
        <div class="band-card">
          <p class="band-label">First product using it</p>
          <p>
            <a :href="HRVIBE_URL" target="_blank" rel="noopener"><strong>Hrvibe</strong></a>
            uses Codevibe Sign for employee documents such as offer letters and policies.
          </p>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="legal">
      <div class="wrap">
        <h2 id="legal">Two kinds of signature</h2>
        <p class="section-lead">How the law in India sees each one, in short.</p>
        <div class="legal-grid">
          <div class="card">
            <h3>Simple electronic signature</h3>
            <p>
              The built-in flow. An agreement made by electronic means is valid and enforceable (IT
              Act 2000, s.10A, with the Indian Contract Act). The audit trail and the sealed file
              show who agreed and when. It suits offer letters, policies, NDAs and most business
              documents.
            </p>
          </div>
          <div class="card">
            <h3>Aadhaar eSign</h3>
            <p>
              An electronic signature under IT Act s.3A, issued through a licensed eSign Service
              Provider after the signer confirms with Aadhaar. Use it, or a DSC, where a law asks
              for a document to be signed in that statutory sense.
            </p>
          </div>
        </div>
        <p class="fineprint">
          Some documents cannot be signed electronically at all, such as wills, powers of attorney
          and property sale deeds. This is not legal advice.
          <a href="/legal">Read the legal notes</a>.
        </p>
      </div>
    </section>

    <section class="section alt" aria-labelledby="faq">
      <div class="wrap faq-wrap">
        <h2 id="faq">Questions</h2>
        <div class="faq">
          <details v-for="item in faqs" :key="item.q">
            <summary>{{ item.q }}</summary>
            <p>{{ item.a }}</p>
          </details>
        </div>
      </div>
    </section>

    <section class="section cta" aria-labelledby="start">
      <div class="wrap cta-inner">
        <h2 id="start">Read the docs, then try it</h2>
        <p class="section-lead">
          Start with the concepts, or go straight to sending your first envelope.
        </p>
        <div class="actions center">
          <a class="btn btn-primary" href="/getting-started/">Get started</a>
          <a class="btn btn-ghost" href="/concepts/envelopes">Learn the concepts</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  color: var(--vp-c-text-1);
}

.wrap {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}

h1,
h2,
h3 {
  font-family: var(--vp-font-family-heading);
  letter-spacing: -0.015em;
  color: var(--vp-c-text-1);
}

h2 {
  font-size: clamp(26px, 3.2vw, 34px);
  line-height: 1.2;
  font-weight: 600;
  margin: 0 0 10px;
}

h3 {
  font-size: 18px;
  line-height: 1.35;
  font-weight: 600;
  margin: 0 0 8px;
}

p {
  line-height: 1.65;
}

.hero {
  padding: 56px 0 72px;
  background: radial-gradient(60% 70% at 85% 30%, rgba(45, 212, 191, 0.12), transparent 70%),
    radial-gradient(50% 60% at 10% 0%, rgba(27, 106, 224, 0.1), transparent 70%);
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 48px;
  align-items: center;
}

.eyebrow {
  display: inline-block;
  font: 600 13px var(--vp-font-family-heading);
  letter-spacing: 0.02em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border-radius: 999px;
  padding: 4px 12px;
  margin: 0 0 20px;
}

h1 {
  font-size: clamp(36px, 5.2vw, 58px);
  line-height: 1.08;
  font-weight: 700;
  margin: 0 0 20px;
  max-width: 17ch;
}

.lead {
  font-size: 19px;
  color: var(--vp-c-text-2);
  max-width: 34em;
  margin: 0 0 32px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.actions.center {
  justify-content: center;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 22px;
  border-radius: 10px;
  font: 600 16px var(--vp-font-family-heading);
  text-decoration: none;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.btn-primary {
  background: var(--cv-blue);
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--cv-blue-dark);
}

.btn-ghost {
  border: 1.5px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
}

.btn-ghost:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.btn:focus-visible,
.text-link:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--cv-teal);
  outline-offset: 3px;
}

.hero-art {
  display: flex;
  justify-content: center;
}

.section {
  padding: 72px 0;
}

.section.alt {
  background: var(--vp-c-bg-alt);
}

.section-lead {
  font-size: 17px;
  color: var(--vp-c-text-2);
  margin: 0 0 32px;
  max-width: 40em;
}

.card {
  background: var(--cv-surface);
  border: 1px solid var(--cv-surface-line);
  border-radius: 14px;
  padding: 22px;
}

.card p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 15px;
}

.steps,
.features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 16px;
}

.steps {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.features {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.features .card {
  border-top: 3px solid var(--cv-blue);
}

.features .card:nth-child(4n + 2) {
  border-top-color: var(--cv-teal);
}

.features .card:nth-child(4n + 3) {
  border-top-color: var(--cv-navy);
}

.dark .features .card:nth-child(4n + 3) {
  border-top-color: #6ea3f5;
}

.features .card:nth-child(4n + 4) {
  border-top-color: var(--cv-warm);
}

.num {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--cv-navy);
  color: #ffffff;
  font: 600 15px var(--vp-font-family-heading);
  margin-bottom: 14px;
}

.dark .num {
  background: var(--cv-blue);
}

.code-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 40px;
  align-items: start;
}

.note {
  font-size: 15px;
  color: var(--vp-c-text-2);
  margin: 0 0 20px;
}

.badge {
  display: inline-block;
  font: 600 12px var(--vp-font-family-heading);
  background: rgba(241, 166, 106, 0.22);
  color: #8a4b17;
  border-radius: 6px;
  padding: 2px 8px;
  margin-right: 6px;
}

.dark .badge {
  color: var(--cv-warm);
}

.text-link {
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.text-link:hover {
  text-decoration: underline;
}

.code-box {
  min-width: 0;
}

.code-box :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 14px;
}

.band {
  background: var(--cv-navy);
  color: #eaf0f7;
  padding: 64px 0;
}

.band h2 {
  color: #ffffff;
}

.band p {
  color: #c4d0de;
  margin: 0;
  max-width: 36em;
}

.band a {
  color: var(--cv-teal);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.band-grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 40px;
  align-items: center;
}

.band-card {
  background: var(--cv-navy-2);
  border: 1px solid #22364d;
  border-left: 4px solid var(--cv-teal);
  border-radius: 12px;
  padding: 22px;
}

.band-label {
  font: 600 13px var(--vp-font-family-heading);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--cv-warm) !important;
  margin-bottom: 6px !important;
}

.legal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.fineprint {
  font-size: 15px;
  color: var(--vp-c-text-2);
  margin: 20px 0 0;
}

.fineprint a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.faq-wrap {
  max-width: 820px;
}

.faq details {
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 16px 0;
}

.faq summary {
  cursor: pointer;
  font: 600 17px var(--vp-font-family-heading);
  list-style: none;
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.faq summary::-webkit-details-marker {
  display: none;
}

.faq summary::after {
  content: '+';
  color: var(--vp-c-brand-1);
  font-size: 22px;
  line-height: 1;
}

.faq details[open] summary::after {
  content: '−';
}

.faq p {
  margin: 10px 0 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
}

.cta {
  text-align: center;
}

.cta .section-lead {
  margin-left: auto;
  margin-right: auto;
}

@media (max-width: 960px) {
  .hero-grid,
  .code-grid,
  .band-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .steps,
  .features {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .wrap {
    padding: 0 16px;
  }

  .hero {
    padding: 32px 0 48px;
  }

  .lead {
    font-size: 17px;
  }

  .section {
    padding: 52px 0;
  }

  .steps,
  .features,
  .legal-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .actions .btn {
    flex: 1 1 auto;
  }
}
</style>
