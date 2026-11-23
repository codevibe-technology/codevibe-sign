---
title: Credits and billing
description: Buy Aadhaar eSign credits on Codevibe Sign, see how a credit is held, used or returned, and find your GST tax invoices.
---

# Credits and billing

This page is about the hosted app at [sign.codevibe.in](https://sign.codevibe.in). A
self-hosted install has no credits and no billing pages; see
[Self-host with Docker](/getting-started/docker).

Admins and owners find everything here under **Settings, Billing**.

## Billing details come first

Before the first payment, add the details that are printed on your invoices: the legal name,
the address with its state and PIN code, a billing email and, if you have one, your GSTIN. The
GSTIN is checked as you type, including that it belongs to the state you chose. Billing is
available for addresses in India.

## Aadhaar eSign credits

One completed Aadhaar eSign uses one credit. Credits are bought in packs. The page shows the
price of one eSign on your plan, the pack total, the GST and the amount to pay before anything
is charged. If the price is not published yet it says "Price coming soon" and nothing can be
bought.

Payment is by card, UPI or net banking through Razorpay. The credits are added as soon as the
payment is confirmed, which usually takes a few seconds. If you close the window early, the
payment is still confirmed in the background and the credits appear on the page.

### When a credit is used

| What happens                                    | The credit                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| The signer starts the Aadhaar eSign             | is held                                                                  |
| The eSign completes                             | is used                                                                  |
| The signer declines, or the eSign fails         | is returned                                                              |
| The eSign is not finished in time (24 hours)    | is returned                                                              |
| The envelope is voided or expires while waiting | is returned                                                              |
| The signer starts again after a failure         | a credit is held again, as at first                                      |
| The signer starts again with other details      | a second credit is held; the first is returned when its request runs out |

The page shows credits as available and held, with a history of every purchase, hold, use and
return. A balance never goes below zero: with no credit available, an envelope with an Aadhaar
signer cannot be sent.

Rarely an eSign is signed after its credit was returned, for example when the signer finishes
at the provider after the wait ended, and no credit is left by then. That eSign is shown as
owed. The next credits you buy pay for it first, and Aadhaar eSign starts again after that.

Credits do not expire. This is the current policy.

A Cloud workspace that connects its own Leegality account uses no credits; see
[Aadhaar eSign with Leegality](/guides/aadhaar-leegality#your-own-leegality-account).

## GST tax invoices

Every payment, whether for credits, a Cloud term, extra members or installation help, produces
a GST tax invoice as a PDF. It is emailed to your billing email and listed under
**Settings, Billing**, where it can be downloaded again at any time.

- **Seller:** Codevibe Technology Private Limited, with its GSTIN and registered address.
- **Place of supply:** the state in your billing details.
- **Tax:** GST at 18% on top of the price. A buyer in the seller's state (Haryana) is charged
  CGST 9% and SGST 9%; a buyer in any other state is charged IGST 18%.
- **Number:** `CV-` followed by the financial year and a running number, for example
  `CV-2026270001` for the first invoice of 2026-27. Numbers run without gaps.
- **Line items** name what was bought, how many and the price of each, for example
  "Aadhaar eSign credits × 50" with the price of one eSign.

The invoice shows the amount paid, the payment method and the payment reference.

### Test mode

While the app shows "Test mode", payments use test keys and no money moves. Documents made in
test mode are numbered separately (`T-...`) and say they are not tax documents.

## Cloud plan payments

Paying for the Cloud plan and for extra members works the same way and is described under
[Plans and pricing](/guides/pricing#cloud).
