import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import postgres from 'postgres';
import { PLANS } from '../src/lib/plans';
import { setAccountPlanByName } from '../src/server/plan-admin';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// Bundled into ops/plan-set.mjs for the Docker image, where it is run with plain node.
const command = import.meta.url.endsWith('.mjs')
  ? 'node ops/plan-set.mjs'
  : 'pnpm --filter web plan:set';
const [target, plan] = process.argv.slice(2);
if (!target || !plan) {
  console.error(`Usage: ${command} <workspace-slug or owner-email> <${PLANS.join('|')}>`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the database of the install.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const changedBy = process.env.PLAN_CHANGED_BY?.trim() || `script:${userInfo().username}`;
  const change = await setAccountPlanByName(sql, { target, plan, changedBy });
  const who = `Account ${change.accountId} (${change.owner ?? 'no owner'})`;
  console.log(
    change.from === change.to
      ? `${who} is already on ${change.to}; recorded by ${changedBy}.`
      : `${who}: ${change.from} -> ${change.to}, recorded by ${changedBy}.`,
  );
  console.log(`Workspaces on this account: ${change.workspaces.join(', ') || 'none'}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
