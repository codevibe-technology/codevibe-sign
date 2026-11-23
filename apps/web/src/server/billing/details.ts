import 'server-only';
import type postgres from 'postgres';
import type { BillingDetails } from '@/lib/billing/details';
import { recordAudit } from './audit';

type Sql = postgres.Sql | postgres.TransactionSql;

interface Row {
  legal_name: string;
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  pin: string;
  state_code: string;
  email: string;
}

/** Who the workspace's invoices are made out to, or null until someone fills the form in. */
export async function getBillingDetails(
  sql: Sql,
  workspaceId: string,
): Promise<BillingDetails | null> {
  const [row] = await sql<Row[]>`
    select legal_name, gstin, address_line1, address_line2, city, pin, state_code, email
    from app_billing_details where workspace_id = ${workspaceId}`;
  if (!row) return null;
  return {
    legalName: row.legal_name,
    gstin: row.gstin,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    pin: row.pin,
    stateCode: row.state_code,
    email: row.email,
  };
}

/** Saves details already checked with `billingDetailsSchema`. Invoices issued earlier keep theirs. */
export async function saveBillingDetails(
  sql: postgres.Sql,
  input: { workspaceId: string; userId: string; details: BillingDetails },
): Promise<void> {
  const { details: d } = input;
  await sql.begin(async (tx) => {
    await tx`
      insert into app_billing_details (
        workspace_id, legal_name, gstin, address_line1, address_line2, city, pin, state_code,
        email, updated_by
      ) values (
        ${input.workspaceId}, ${d.legalName}, ${d.gstin}, ${d.addressLine1}, ${d.addressLine2},
        ${d.city}, ${d.pin}, ${d.stateCode}, ${d.email}, ${input.userId}
      )
      on conflict (workspace_id) do update set
        legal_name = excluded.legal_name, gstin = excluded.gstin,
        address_line1 = excluded.address_line1, address_line2 = excluded.address_line2,
        city = excluded.city, pin = excluded.pin, state_code = excluded.state_code,
        email = excluded.email, updated_by = excluded.updated_by, updated_at = now()`;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorId: input.userId,
      action: 'billing.details_updated',
      data: { stateCode: d.stateCode, registered: d.gstin !== null },
    });
  });
}
