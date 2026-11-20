import { serveDocs } from '@/server/docs';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(_request: Request, { params }: Context) {
  return serveDocs((await params).path ?? []);
}

export async function HEAD(_request: Request, { params }: Context) {
  return serveDocs((await params).path ?? [], true);
}
