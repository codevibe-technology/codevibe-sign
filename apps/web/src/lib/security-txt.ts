export const SECURITY_CONTACT = 'mailto:security@codevibe.in';
export const SECURITY_POLICIES = [
  'https://github.com/codevibe-technology/codevibe-sign/blob/main/SECURITY.md',
];

/** RFC 9116 wants the expiry less than a year ahead; the file is rebuilt on every request. */
const VALID_DAYS = 360;

/** The `/.well-known/security.txt` of the hosted cloud, as RFC 9116 describes it. */
export function securityTxt({ appUrl, now }: { appUrl: string; now: Date }): string {
  const expires = new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
    ...SECURITY_POLICIES.map((url) => `Policy: ${url}`),
    `Policy: ${appUrl}/docs/security`,
    'Preferred-Languages: en',
    `Canonical: ${appUrl}/.well-known/security.txt`,
    '',
  ].join('\n');
}
