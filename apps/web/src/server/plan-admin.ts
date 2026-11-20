import type postgres from 'postgres';
import { isPlan, type Plan } from '@/lib/plans';
import { randomId } from './crypto';

export interface PlanChange {
  workspaceId: string;
  slug: string;
  from: Plan;
  to: Plan;
}

/**
 * Moves a workspace to another plan and records who did it, in one transaction. For the
 * operator's `plan:set` script; nothing in the app calls it.
 */
export async function setWorkspacePlan(
  sql: postgres.Sql,
  input: { slug: string; plan: string; changedBy: string },
): Promise<PlanChange> {
  if (!isPlan(input.plan)) {
    throw new Error(`Unknown plan "${input.plan}". Use free, cloud or unlimited.`);
  }
  const to = input.plan;
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; plan: Plan }[]>`
      select id, plan from app_workspaces where slug = ${input.slug} for update`;
    if (!row) throw new Error(`No workspace has the slug "${input.slug}".`);
    await tx`update app_workspaces set plan = ${to}, updated_at = now() where id = ${row.id}`;
    await tx`insert into app_plan_changes (id, workspace_id, from_plan, to_plan, changed_by)
      values (${randomId('plan')}, ${row.id}, ${row.plan}, ${to}, ${input.changedBy})`;
    return { workspaceId: row.id, slug: input.slug, from: row.plan, to };
  });
}
