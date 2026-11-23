import 'server-only';

/**
 * Who runs this install, for the footer of its emails: the invoice seller's name and address
 * when billing is set up, as one line. Null on installs that do not sell anything.
 */
export function mailOrg(source: NodeJS.ProcessEnv = process.env): string | null {
  const name = source.INVOICE_SELLER_NAME?.trim();
  const address = source.INVOICE_SELLER_ADDRESS?.replace(/\s*\n\s*/g, ', ').trim();
  if (!name) return null;
  return address ? `${name}, ${address}` : name;
}
