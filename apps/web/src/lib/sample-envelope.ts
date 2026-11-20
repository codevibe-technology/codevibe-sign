/** The first-run sample: an A4 page with a signature and a date box for the new user. */
export const SAMPLE_TITLE = 'Try it: sample agreement';
export const SAMPLE_FILE_NAME = 'sample-agreement.pdf';
export const SAMPLE_PAGE = { width: 595.28, height: 841.89 } as const;

/** Field boxes in PDF points from the top-left of the page; the PDF draws a line under each. */
export const SAMPLE_FIELDS = [
  {
    type: 'signature',
    caption: 'Your signature',
    rect: { x: 64, y: 600, width: 220, height: 56 },
  },
  {
    type: 'date_signed',
    caption: 'Date',
    rect: { x: 340, y: 624, width: 160, height: 32 },
  },
] as const;

export const SAMPLE_MESSAGE =
  'This is a practice document. Send it, open the email, sign it and download the sealed copy.';
