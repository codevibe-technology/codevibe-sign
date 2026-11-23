---
title: Send a document
description: Send a PDF for signature from the Codevibe Sign app in four steps, choose the signing order, identity check, expiry and reminders, then follow, remind, void or download it.
---

# Send a document

Press **Send a document** on the dashboard or under **Envelopes**. An envelope is one signing
request: one or more PDFs, the people who act on them and their fields. It takes four steps.

## 1. Documents {#documents}

Drop in up to 20 PDFs. Each file can be up to 20 MB, and on the Free plan 10 MB a file and
25 MB for the whole envelope. Password-protected PDFs are refused: remove the password first.

## 2. Recipients {#recipients}

Add each person with **Add recipient**, or yourself with **Add me**. Up to 50 people.

| Role            | What they do                                    |
| --------------- | ----------------------------------------------- |
| **Signer**      | Fills in their fields and signs.                |
| **Approver**    | Reads the document and approves it. No fields.  |
| **Gets a copy** | Receives the sealed copy when everyone is done. |

At least one signer or approver is needed.

**Identity check** decides how each person proves it is them before they act:

- **Email link + code (recommended):** the link in their email, then a 6-digit code sent by
  email.
- **Email link + SMS code:** the code goes by text message to a **Mobile number** in `+91…`
  format. Only where the install has SMS set up.
- **Email link only:** weaker evidence; anyone with the email could sign.
- **Aadhaar eSign:** the signer signs with their Aadhaar OTP through Leegality. It costs one
  credit on the cloud and has four rules: one Aadhaar signer, one document, that signer signs
  last, and the order is **One after another**. See [Aadhaar eSign](/admin/aadhaar-esign).

**Signing order** is **One after another** (each person is invited when the one before has
finished) or **Everyone at once**.

Once recipients are added the envelope is saved as a draft and every change saves as you go.

## 3. Fields {#fields}

Pick a recipient, then place their fields on the pages: **Signature**, **Initials**,
**Date signed**, **Name**, **Text** and **Checkbox**. Every signer needs at least one required
signature. To repeat a field on many pages, or place initials on every page at once, see
[Fields across pages and tags](/guides/field-tags).

## 4. Review & send {#review}

- **Title**: also the subject of the email. Up to 200 characters.
- **Message (optional)**: shown in the email and on the signing page.
- **Expires after**: 7, 14, 30 (the default), 60 or 90 days.
- **Automatic reminders**: Off, every day, every 2 days (the default), every 3 days or every
  week, up to 5 reminders to whoever has not acted.

Press **Send**. On the Free plan this counts as one of your 10 envelopes this month; see
[Plans and pricing](/guides/pricing#free).

## Follow it

**Envelopes** lists every envelope with its status. Search by title, filter by status, and
select several to void them together.

| Status                 | Means                                    |
| ---------------------- | ---------------------------------------- |
| **Draft**              | Not sent yet.                            |
| **Waiting for others** | Sent; someone still has to act.          |
| **Completed**          | Everyone acted. The sealed PDF is ready. |
| **Declined**           | A recipient declined, with a reason.     |
| **Expired**            | The expiry date passed first.            |
| **Voided**             | Withdrawn by the sender or an admin.     |

Each recipient shows as **Not yet invited**, **Invited**, **Opened**, **Signed**,
**Approved** or **Declined**. The envelope page updates by itself while it is open.

On the envelope page:

- **Remind** sends a fresh link to whoever's turn it is; **Resend link** does it for one
  person.
- **Correct** fixes a recipient's name, email or phone.
- **Get a link to share** gives a signing link to pass on yourself, for example over chat.
  Admins and owners only. It is shown once and makes earlier links stop working.
- **Recall and edit** withdraws the envelope and opens a copy to change; anyone who signed
  signs again. A declined envelope offers **Revise and resend**. See
  [Fix an envelope after sending](/guides/fix-after-sending).
- **Void** withdraws it for good, with a reason the recipients see. Members void what they
  sent; admins and owners void anything in the workspace.
- **Public record** turns the public record page of this envelope off or on. See
  [Verify a sealed PDF](/guides/verify-pdf#from-the-certificate-page).

## Download the result

When it is completed, the **Documents** card offers the **Signed PDF** (sealed, with the
certificate as its last page), the **Certificate** on its own and the **Original**. Every
recipient also gets the sealed copy by email: attached when it is up to 10 MB, otherwise as a
personal download link that works for 30 days.

## Next

[Sign a document](/app/sign): what your recipients see.
