import { auth } from '@/server/auth/auth';

export const dynamic = 'force-dynamic';

const handle = (request: Request) => auth().handler(request);

export const GET = handle;
export const POST = handle;
