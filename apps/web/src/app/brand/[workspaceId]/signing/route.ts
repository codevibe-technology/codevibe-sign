import { getSigningBrand } from '@/server/brand';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * The header of a workspace's signing page: name, logo, colour, font and badge. Public like the
 * logo, since anyone with a signing link sees it; it holds nothing the emails do not show.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const brand = /^ws_[0-9a-f]{20}$/.test(workspaceId)
    ? await getSigningBrand(db(), workspaceId)
    : null;
  if (!brand) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(brand, {
    headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}
