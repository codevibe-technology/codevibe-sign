// Copies the built docs site (apps/site, base /docs/) into docs-dist, which the app serves at
// /docs. Build the site first: `pnpm --filter site build`.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../site/.vitepress/dist', import.meta.url));
const to = fileURLToPath(new URL('../docs-dist', import.meta.url));

if (!existsSync(from)) {
  console.error(
    'No built docs at apps/site/.vitepress/dist. Run `pnpm --filter site build` first.',
  );
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('Copied the docs to apps/web/docs-dist.');
