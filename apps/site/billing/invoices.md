---
title: Invoices and credit notes
description: Where to find Codevibe Sign GST tax invoices, who can see and download them, what they contain, how they are numbered, and what happens to an invoice when a payment is refunded.
---

# Invoices and credit notes

This page is about [sign.codevibe.in](https://sign.codevibe.in). A self-hosted install issues
no invoices in Codevibe's name.

## Where to find them

Every payment, whether for eSign credits, a Cloud term, extra members or installation help,
produces a GST tax invoice as a PDF. It is emailed to the billing email in your billing
details and listed under **Settings, Billing**, **Invoices**, where it can be downloaded again
at any time.

Invoices belong to the account, so the same list shows in every workspace of the account.

## Who can see them

| Person                                                 | Invoices                                |
| ------------------------------------------------------ | --------------------------------------- |
| The account holder                                     | Sees, downloads, pays                   |
| A [Billing admin](/admin/team-and-roles#billing-admin) | Sees, downloads, pays                   |
| Other owners and admins                                | No. A direct link to a PDF answers 403. |
| Members and viewers                                    | No                                      |

## Before the first payment

Add your billing details under **Settings, Billing**, **Billing details**. They are printed
on every invoice: **Legal name**, **GSTIN (optional)**, the address with **PIN code** and
**State or union territory**, and the **Billing email**. The GSTIN is checked as you type,
including that it belongs to the state you chose. Billing is available for addresses in India.
Details changed later appear on later invoices; invoices already issued do not change.

## What an invoice shows

- **Seller:** Codevibe Technology Private Limited, with its GSTIN and registered address.
- **Buyer:** your billing details. **Place of supply** is your state.
- **Line items:** what was bought, how many and the price of each, with the SAC code 997331.
- **Tax:** GST at 18% on top of the price. In Haryana, the seller's state, it is CGST 9% and
  SGST 9%; everywhere else IGST 18%.
- **Payment:** the amount paid, the method and the payment reference.
- **Number:** `CV-`, the financial year as six digits, then a running number, for example
  `CV-2026270001` for the first invoice of 2026-27. Numbers run without gaps; the year runs
  1 April to 31 March.

While the app shows **Test mode**, no money moves and documents are numbered `T-...` and say
they are not tax documents.

## Refunds and credit notes

- **A payment that could not be applied**, for example one made after its checkout timed
  out, adds nothing and gets no invoice. You are told by email that a refund is coming.
- **A full refund** takes back what the payment bought, as far as it is unused: credits not yet
  used or held, extra members for that term, or the term itself (the account moves back to its
  earlier term, or to Free; nothing is deleted).
- **Credit notes are not made in the app.** The invoice stays in your list as issued. For a
  refunded invoice, the credit note is issued separately by Codevibe and sent to your billing
  email. Write to [hello@codevibe.in](mailto:hello@codevibe.in) if you need one.

Cloud terms are not refunded when you cancel: Cloud stays on until the end of the paid term.
See [Plans and pricing](/guides/pricing#cancelling).

## Next

[Installation help and hosting](/billing/install-help)
