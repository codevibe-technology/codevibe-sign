import { serveDocs } from '@/server/docs';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return serveDocs((await params).path ?? [], false, new URL(request.url).search);
}

export async function HEAD(request: Request, { params }: Context) {
  return serveDocs((await params).path ?? [], true, new URL(request.url).search);
}
