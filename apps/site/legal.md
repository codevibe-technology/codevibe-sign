---
title: Legal
description: When an electronic signature is enough, when you need Aadhaar eSign or a DSC, and which documents cannot be signed electronically. Not legal advice.
---

# Legal

::: warning Not legal advice
This page explains how Codevibe Sign fits the law in general terms. It is not legal advice. Ask
your own counsel which kind of signature a particular document needs.
:::

Codevibe Sign supports two kinds of signature.

## India

### Simple electronic signature

The built-in flow. Under the Information Technology Act 2000, s.10A, a contract formed by
electronic means is not unenforceable just because it was formed that way, and the Indian
Contract Act applies to it as to any other contract.

The evidence is the record: the audit trail of who opened, authenticated and signed, from which
IP address and when, and the sealed file that shows nothing changed afterwards. Electronic
records are admissible under the Indian evidence law, subject to its conditions on
certification.

It suits offer letters, appointment letters, policies, NDAs, vendor agreements and most other
business documents.

### Aadhaar eSign

An electronic signature under IT Act s.3A, using a technique in the Second Schedule. The signer
authenticates with Aadhaar, and a licensed eSign Service Provider issues a short-lived
certificate and signs the document hash with it.

Use Aadhaar eSign, or a Digital Signature Certificate (DSC), where a law asks for a document to
be "signed" in that statutory sense. Codevibe Sign supports it through
[`@codevibe/sign-aadhaar`](/api/aadhaar), with your own provider account.

### Documents that cannot be signed electronically

The IT Act's First Schedule excludes:

- negotiable instruments other than cheques;
- powers of attorney;
- trust deeds;
- wills and other testamentary dispositions;
- contracts for the sale or conveyance of immovable property, or any interest in it.

These need a signature on paper, and some also need stamping or registration.

## Elsewhere

Other countries have their own rules. Examples:

- **European Union**: eIDAS recognises simple, advanced and qualified electronic signatures.
  The built-in flow is a simple electronic signature.
- **United States**: the ESIGN Act and UETA give electronic signatures the same effect as
  handwritten ones for most transactions.

Check the rules where you and your signers are before relying on any signature for a
particular document.

## What Codevibe Sign provides

- A clear record of each person's actions, with authentication method, IP address, user agent
  and time.
- A tamper-evident audit chain and a sealed PDF that anyone can verify.
- An option to use a statutory electronic signature where the law requires one.

What it does not provide is a legal opinion on whether a particular document, signed a
particular way, will be enforceable in a particular case.
