---
title: Electronic evidence (section 63 BSA)
description: How to produce a Codevibe Sign sealed PDF and its audit trail in an Indian court with the certificate under section 63 of the Bharatiya Sakshya Adhiniyam 2023, with a fillable template.
---

# Electronic evidence under section 63 BSA

::: warning This is not legal advice
This page explains in general terms how a sealed PDF from Codevibe Sign can be produced as
evidence in India. It is not legal advice. Your advocate decides what to file, who signs the
certificate and whether anything more is needed in your case.
:::

The Bharatiya Sakshya Adhiniyam 2023 (BSA) replaced the Indian Evidence Act 1872 from 1 July 2024. Its section 63 takes the place of the old section 65B on electronic records.

## What the law says

- **Section 61.** An electronic or digital record is not inadmissible only because it is
  electronic. Subject to section 63, it has the same legal effect, validity and enforceability
  as any other document.
- **Section 62.** The contents of electronic records may be proved under section 63.
- **Section 63(1) and (2).** A computer output (a printout, or a copy on any media) is treated
  as a document, and is admissible without producing the original, if four conditions are met:
  the device was used regularly for the activity over that period by the person with lawful
  control of it; information of that kind was fed in regularly in the ordinary course of that
  activity; the device worked properly, or any fault did not affect the record; and the output
  reproduces or is derived from what was fed in.
- **Section 63(3).** Several computers, servers, networks, a cloud resource or an intermediary
  used for the activity count as one device.
- **Section 63(4).** Each time the record is submitted, it must come with a certificate that
  identifies the record and how it was produced, gives particulars of the device, and deals with
  the conditions in section 63(2). The certificate is in the form in the Schedule. It is signed
  by the person in charge of the device or of the activity **and** by an expert, and it is
  enough to state matters to the best of their knowledge and belief.

### The certificate in the Schedule

The Schedule has two parts with the same structure:

- **Part A, filled in by the party** producing the record: their name and address, the source
  of the record (computer, server, cloud, mobile and so on), its make, model, serial number or
  cloud ID, a statement that the source was under lawful control, used regularly, fed in the
  ordinary course and working properly, whether the source is owned, maintained, managed or
  operated by them, and the **hash value** of the record with the algorithm used (SHA-1,
  SHA-256, MD5 or another accepted standard). A hash report is enclosed. Signed with the date,
  the time in IST (24 hour) and the place.
- **Part B, filled in by an expert**: the same particulars of the source and the hash value,
  signed with their name and designation, date, time and place.

In _Pune Bar Association v. Union of India_ (Supreme Court, 22 May 2026), a three-judge bench
upheld section 63(4) and the Schedule, and described the hash value as an electronic
fingerprint of the record. It said that a person with special skill in computer science and
cyber forensics may be treated as an expert under section 39(1) and sign Part B, and that an
earlier Madras High Court view limiting Part B to examiners notified under section 79A of the
IT Act is not a binding precedent. It left the full scope of Part B open for a later case, so
ask your advocate who should sign it.

## What to produce from Codevibe Sign

For each signed document:

1. **The sealed PDF** you downloaded or received by email when the envelope completed. Do not
   open and save it again in another program: saving changes the bytes, the hash and the seal.
2. **Its SHA-256 hash.** Drop the file on [sign.codevibe.in/verify](https://sign.codevibe.in/verify)
   and note the SHA-256 shown, or compute it yourself:

   ```sh
   shasum -a 256 offer-letter-sealed.pdf        # macOS and Linux
   certutil -hashfile offer-letter-sealed.pdf SHA256   # Windows
   ```

   Print the result, or a screenshot of the verify page, as the hash report.

3. **The signing certificate page** at the end of the sealed PDF. It lists each recipient,
   how they proved who they were and when they signed, the SHA-256 of the original file and
   the head of the audit chain. The audit trail, with the IP address and browser of each
   action, is on the envelope page for workspace members and can be exported from there.
4. **The verify page result**, which shows that the seal is intact, which certificate made it
   and that the audit chain still matches.
5. **The seal certificate** and its fingerprint, from
   [How the seal works in PDF readers](/guides/seal-in-pdf-readers), if the other side wants
   to check the seal independently.

### Filling in Part A for a Codevibe Sign record

| Schedule item                        | What to write                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source of the record                 | Cloud (and Computer, for the device you downloaded it to)                                                                                                                         |
| Make and model, cloud ID             | Codevibe Sign at sign.codevibe.in, workspace name, envelope ID (printed on the certificate page)                                                                                  |
| Lawful control and regular use       | Your organisation's workspace, used in the ordinary course to send documents for signature from the date you started using it                                                     |
| Owned, maintained, managed, operated | Usually "managed" or "operated by me" for your workspace. The service itself is operated by Codevibe Technology. Self-hosted installs are usually "owned" or "maintained" by you. |
| Hash value and algorithm             | The SHA-256 of the sealed PDF, as above                                                                                                                                           |

The person who signs Part A should be someone in charge of the workspace or of the signing
process, such as an admin or the HR or legal lead who sent the envelope.

## Download the template

<p><a href="/docs/section-63-certificate-template.md" download>Download the fillable certificate template (Markdown)</a></p>

The template follows the Schedule's wording for Parts A and B and adds a short annexure that
describes the Codevibe Sign record. Open it in any text editor or word processor, fill in the
blanks, print it and sign it. Keep the Schedule's own wording; your advocate may want it on
stamp paper or as an affidavit, depending on the court.

## Sources

- The Bharatiya Sakshya Adhiniyam 2023 (No. 47 of 2023), sections 61 to 63 and the Schedule,
  Gazette of India, Extraordinary, Part II, Section 1, 25 December 2023:
  [PRS Legislative Research copy of the gazette](https://prsindia.org/files/bills_acts/acts_parliament/2023/The%20Bharatiya%20Sakshya%20Bill,%202023.pdf)
  and [India Code](https://www.indiacode.nic.in/handle/123456789/20063).
- _Pune Bar Association v. Union of India_, 2026 SCC OnLine SC 1297, reported by
  [SCC Online](https://www.scconline.com/blog/post/2026/07/08/sc-upholds-admissibility-of-electronic-evidence-under-section-63-4-bsa/)
  and [LiveLaw](https://www.livelaw.in/top-stories/supreme-court-rejects-challenge-to-s634-bsa-mandating-hash-value-disclosure-for-electronic-evidence-535950).

This is not legal advice.
