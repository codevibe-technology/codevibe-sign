# Plans and pricing

Codevibe Sign runs in three ways. Every one of them seals documents the same way and keeps the
same audit trail; the plans differ in limits and in who runs the server.

<!-- plans:start -->

|                                         | Free                                        | Cloud                                                         | Self-hosted                          |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| Workspaces                              | 1 workspace                                 | Unlimited workspaces, one subscription                        | Unlimited                            |
| Envelopes sent                          | 10 envelopes a month                        | Unlimited                                                     | Unlimited                            |
| Members                                 | 2 members across your workspaces            | 25 members included across your workspaces, more can be added | Unlimited                            |
| Active templates                        | 2 templates across your workspaces          | Unlimited                                                     | Unlimited                            |
| Bulk send                               | Up to 10 rows in one send                   | Up to 500 rows in one send (fair use)                         | Unlimited                            |
| API requests                            | 100 requests a month across your workspaces | Unlimited, up to 10,000 requests a day (fair use)             | Unlimited                            |
| Webhooks                                | Not included                                | Up to 10 endpoints (fair use)                                 | Included                             |
| PDF size                                | 10 MB a file, 25 MB an envelope             | 25 MB a file, 100 MB an envelope                              | Set by you                           |
| Stored documents                        | 200 MB                                      | 20 GB (fair use)                                              | Your own disk                        |
| Your own signing domain                 | Not included                                | Included                                                      | Included                             |
| "Secured by Codevibe Sign" badge        | Always shown                                | Optional                                                      | Optional                             |
| Aadhaar eSign                           | Pay per eSign with prepaid credits          | Pay per eSign with prepaid credits, at a lower price          | With your own eSign provider account |
| Connect your own eSign provider account | Not included                                | Included                                                      | Included                             |

<!-- plans:end -->

"Fair use" marks a ceiling that is not part of what the plan sells. It is there so that one
workspace cannot slow the service down for the others. Write to us if you reach one.

## Free

A workspace on [sign.codevibe.in](https://sign.codevibe.in) at no charge, with no card needed.
When a limit is reached, the app says which one and how much of it is used. Nothing already
sent is affected: people can still sign and every sealed copy stays downloadable.

- The envelope count starts again on the 1st of each month (UTC).
- The API request count starts again on the 1st of each month in India time. Every request made
  with an API key counts, including one that ends in an error. Past the count the API answers
  `429` with the code `PLAN_LIMIT`, a `Retry-After` header and the time the count starts again.

## Cloud

| What                      | Price                               |
| ------------------------- | ----------------------------------- |
| One workspace, one month  | Rs 999                              |
| One workspace, one year   | Rs 9,990 (ten months, two are free) |
| Each member beyond the 25 | Rs 99 a month                       |

Prices do not include GST at 18%. Every payment gets a GST tax invoice from Codevibe Technology
Private Limited by email, and all invoices are listed under Settings, Billing.

### How paying works

- An admin or owner upgrades from **Settings, Plan and usage**. Add your billing details first;
  they are printed on the invoice. Cloud starts as soon as the payment is confirmed.
- You pay for each term up front by card, UPI or net banking. Nothing is charged automatically
  and there is no payment mandate.
- The next term can be paid in the last 7 days of the current one. It always starts where the
  paid term ends, so paying early does not lose you any days.
- We email a reminder 7, 3 and 1 days before a term ends.

### Extra members

Members beyond the included 25 can be added at any time. In the middle of a term you pay for
the days that are left: the price of a member for the term, times the days left, over the days
in the term, rounded to the nearest paisa. They can be invited as soon as the payment is
confirmed, and the next term includes them. To have fewer, set the number for the next term on
the same page; the current term keeps what was paid for.

### If a term is not renewed

The workspace stays on Cloud for 7 more days. If the term is paid in that time, it continues
from the day the last one ended. After that the workspace moves to the Free plan:

- Nothing is deleted. Documents, templates, members and envelopes in progress all stay.
- The Free limits apply to anything new. A workspace that is over a Free limit keeps what it
  has but cannot add more until it is under the limit.
- Webhooks are paused, and a connected eSign provider account is not used.
- Moving back to Cloud restores everything as it was.

### Cancelling

Cancel at any time from the same page. Cloud stays on until the end of the term you paid for,
then the workspace moves to the Free plan as above. The term already paid for is not refunded.
You can undo the cancellation any time before the term ends.

## Aadhaar eSign

A signer can be asked to sign with Aadhaar eSign. On the cloud this is paid per completed
eSign with prepaid credits, bought in packs from Settings, Billing.

- The price of one eSign is shown on the [pricing section](https://sign.codevibe.in/#pricing)
  and in the app before you buy. It is lower on Cloud than on Free.
- A credit is held when a signer starts and used only when the eSign completes. One that is
  declined, fails or runs out of time costs nothing.
- Credits do not expire.
- A Cloud workspace can connect its own Leegality account instead; Leegality then bills it
  directly and no credits are used.

See [Aadhaar eSign with Leegality](/guides/aadhaar-leegality) and
[Credits and billing](/guides/credits-and-billing).

## Self-hosted

The same app on your own server, free and without limits, under the open-source licences. See
[Self-host with Docker](/getting-started/docker). A self-hosted install has no plans and no
billing pages, and uses your own eSign provider account for Aadhaar eSign. No invoice is ever
issued in Codevibe's name by a self-hosted install.

### Installation help

If you would rather not set it up yourself, an experienced engineer installs Codevibe Sign on
your server within 4 working hours of getting access: Rs 1,999 plus GST, paid online, with a
GST tax invoice. Book it at
[sign.codevibe.in/install-help](https://sign.codevibe.in/install-help). The booking form asks
about the server and a time that suits you. It never asks for a password or a key; access is
arranged with you safely after booking.
