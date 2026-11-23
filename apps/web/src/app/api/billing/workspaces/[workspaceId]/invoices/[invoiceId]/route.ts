import { accountOfWorkspace } from '@/server/accounts';
import { getSessionUser } from '@/server/auth/session';
import { invoicePdf } from '@/server/billing/invoices';
import { billingDeps } from '@/server/billing/runtime';
import { db } from '@/server/db';
import { isHosted } from '@/server/plans';
import { findMembership } from '@/server/workspaces';

export const dynamic = 'force-dynamic';

const notFound = () =>
  Response.json(
    { ok: false, error: 'Invoice not found' },
    { status: 404, headers: { 'cache-control': 'private, no-store' } },
  );

/**
 * An invoice as a PDF, for the owner of the account it was issued to, reached through any
 * workspace of that account. Anyone else, and an invoice of another account, gets the same 404.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; invoiceId: string }> },
) {
  if (!isHosted()) return notFound();
  const user = await getSessionUser();
  if (!user) return notFound();
  const { workspaceId, invoiceId } = await context.params;
  if (workspaceId.length > 64 || invoiceId.length > 64) return notFound();
  const sql = db();
  const membership = await findMembership(sql, user.id, { id: workspaceId });
  if (!membership) return notFound();
  const account = await accountOfWorkspace(sql, membership.workspace.id);
  if (account.ownerUserId !== user.id) return notFound();
  const invoice = await invoicePdf(sql, billingDeps(), account.id, invoiceId);
  if (!invoice) return notFound();
  return new Response(Buffer.from(invoice.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${invoice.number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
