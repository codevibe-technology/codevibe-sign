import type postgres from 'postgres';
import { isPlan, type Plan } from '@/lib/plans';
import { setAccountPlan } from './accounts';
import { randomId } from './crypto';

export interface PlanChange {
  accountId: string;
  /** The account owner's email address; null for an account nobody owns. */
  owner: string | null;
  /** Every workspace the change applies to. */
  workspaces: string[];
  from: Plan;
  to: Plan;
}

/**
 * Moves an account, found by the slug of one of its workspaces or by its owner's email
 * address, to another plan, and records who did it, in one transaction. A plan belongs to an
 * account, so every workspace on it moves together. For the operator's `plan:set` script;
 * nothing in the app calls it.
 */
export async function setAccountPlanByName(
  sql: postgres.Sql,
  input: { target: string; plan: string; changedBy: string },
): Promise<PlanChange> {
  if (!isPlan(input.plan)) {
    throw new Error(`Unknown plan "${input.plan}". Use free, cloud or unlimited.`);
  }
  const to = input.plan;
  const target = input.target.trim();
  return sql.begin(async (tx) => {
    const [found] = target.includes('@')
      ? await tx<{ id: string }[]>`
          select a.id from app_accounts a join auth_users u on u.id = a.owner_user_id
          where lower(u.email) = ${target.toLowerCase()}`
      : await tx<{ id: string }[]>`
          select account_id as id from app_workspaces where slug = ${target}`;
    if (!found) {
      throw new Error(
        target.includes('@')
          ? `No account is owned by "${target}". They get one when they create a workspace.`
          : `No workspace has the slug "${target}".`,
      );
    }
    const [account] = await tx<{ plan: Plan; email: string | null }[]>`
      select a.plan, u.email from app_accounts a
      left join auth_users u on u.id = a.owner_user_id
      where a.id = ${found.id} for update of a`;
    const from = account!.plan;
    // A plan set here is the operator's: billing no longer renews, changes or ends it.
    await setAccountPlan(tx, found.id, { plan: to, source: 'operator' });
    await tx`insert into app_plan_changes (id, account_id, from_plan, to_plan, changed_by)
      values (${randomId('plan')}, ${found.id}, ${from}, ${to}, ${input.changedBy})`;
    const workspaces = await tx<{ slug: string }[]>`
      select slug from app_workspaces where account_id = ${found.id} order by created_at, id`;
    return {
      accountId: found.id,
      owner: account!.email,
      workspaces: workspaces.map((w) => w.slug),
      from,
      to,
    };
  });
}
