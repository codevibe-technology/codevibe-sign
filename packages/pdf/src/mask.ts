/** "shubh@example.com" becomes "s****@example.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return email.length <= 1 ? '*' : `${email.slice(0, 1)}****`;
  }
  return `${email.slice(0, 1)}****${email.slice(at)}`;
}

/** "+919876543210" becomes "+91******3210": country code and last four digits stay. */
export function maskPhone(phone: string): string {
  const compact = phone.replace(/[\s()-]/g, '');
  const keepStart = compact.startsWith('+') ? 3 : 0;
  const keepEnd = 4;
  if (compact.length <= keepStart + keepEnd) {
    return compact.replace(/\d(?=\d{2})/g, '*');
  }
  const hidden = compact.length - keepStart - keepEnd;
  return compact.slice(0, keepStart) + '*'.repeat(hidden) + compact.slice(-keepEnd);
}
