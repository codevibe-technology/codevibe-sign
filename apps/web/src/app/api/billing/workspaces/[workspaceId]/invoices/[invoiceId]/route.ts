import { can } from '@/lib/roles';
import { getSessionUser } from '@/server/auth/session';
import { invoicePdf } from '@/server/billing/invoices';
import { billingDeps } from '@/server/billing/runtime';
import { db } from '@/server/db';
import { findMembership } from '@/server/workspaces';

export const dynamic = 'force-dynamic';

const notFound = () =>
  Response.json(
    { ok: false, error: 'Invoice not found' },
    { status: 404, headers: { 'cache-control': 'private, no-store' } },
  );

/**
 * An invoice as a PDF, for admins and owners of the workspace it was issued to. Anyone else,
 * and an invoice of another workspace, gets the same 404.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; invoiceId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return notFound();
  const { workspaceId, invoiceId } = await context.params;
  if (workspaceId.length > 64 || invoiceId.length > 64) return notFound();
  const sql = db();
  const membership = await findMembership(sql, user.id, { id: workspaceId });
  if (!membership || !can(membership.role, 'billing.manage')) return notFound();
  const invoice = await invoicePdf(sql, billingDeps(), membership.workspace.id, invoiceId);
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
