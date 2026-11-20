import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import postgres from 'postgres';
import { PLANS } from '../src/lib/plans';
import { setWorkspacePlan } from '../src/server/plan-admin';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const [slug, plan] = process.argv.slice(2);
if (!slug || !plan) {
  console.error(`Usage: pnpm --filter web plan:set <workspace-slug> <${PLANS.join('|')}>`);
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
  const change = await setWorkspacePlan(sql, { slug, plan, changedBy });
  console.log(
    change.from === change.to
      ? `${change.slug} is already on ${change.to}; recorded by ${changedBy}.`
      : `${change.slug}: ${change.from} -> ${change.to}, recorded by ${changedBy}.`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
