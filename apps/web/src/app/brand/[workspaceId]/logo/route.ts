import { readLogo } from '@/server/brand';
import { db } from '@/server/db';
import { appRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/**
 * A workspace's logo, public because signing pages and emails show it. Served with the type
 * sniffed at upload, `nosniff` and a CSP that forbids everything, so it can only ever be an image.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const logo = /^ws_[0-9a-f]{20}$/.test(workspaceId)
    ? await readLogo(db(), appRuntime().files, workspaceId)
    : null;
  if (!logo) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(logo.bytes), {
    headers: {
      'Content-Type': logo.type,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
