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
IP address and when, and the sealed file that shows nothing changed afterwards. Under the
Bharatiya Sakshya Adhiniyam 2023, s.61, an electronic record is not inadmissible because it is
electronic; s.63 sets the conditions and asks for a certificate in the form in its Schedule. See
[Electronic evidence (section 63 BSA)](/guides/section-63-certificate) for how to produce a
sealed PDF in court.

It suits offer letters, appointment letters, policies, NDAs, vendor agreements and most other
business documents.

### Aadhaar eSign

An electronic signature under IT Act s.3A, using a technique in the Second Schedule. The signer
authenticates with Aadhaar, and a licensed eSign Service Provider issues a short-lived
certificate and signs the document hash with it.

Use Aadhaar eSign, or a Digital Signature Certificate (DSC), where a law asks for a document to
be "signed" in that statutory sense. Codevibe Sign supports it through
[`@codevibe_technology/sign-aadhaar`](/api/aadhaar), with your own provider account.

### Documents that cannot be signed electronically

Section 1(4) of the IT Act says the Act does not apply to the documents in its First Schedule.
As amended by the Ministry of Electronics and Information Technology's notification
[S.O. 4720(E) of 26 September 2022](https://www.cca.gov.in/sites/files/pdf/ACT/SO4720.pdf)
(published in the Gazette on 4 October 2022), the Schedule now lists:

1. a negotiable instrument as defined in section 13 of the Negotiable Instruments Act 1881,
   other than a cheque, and other than a demand promissory note or bill of exchange issued in
   favour of or endorsed by an entity regulated by the RBI, NHB, SEBI, IRDAI or PFRDA;
2. a power of attorney as defined in section 1A of the Powers of Attorney Act 1882, except one
   that empowers such a regulated entity to act for, on behalf of and in the name of the person
   who executes it;
3. a trust as defined in section 3 of the Indian Trusts Act 1882;
4. a will as defined in section 2(h) of the Indian Succession Act 1925, including any other
   testamentary disposition.

These still need a signature on paper, and some also need stamping or registration.

The same notification omitted the old entry 5, "any contract for the sale or conveyance of
immovable property or any interest in such property", so the IT Act no longer excludes those
contracts. Registration, stamp duty and state rules on e-registration still apply, so many
property documents still go through a sub-registrar on paper.

The web app shows a short, dismissible notice when a document name or envelope title looks like
one of the excluded kinds. It is a reminder only and never blocks sending.

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
