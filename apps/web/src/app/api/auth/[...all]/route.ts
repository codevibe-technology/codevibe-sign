import { handleAuth } from '@/server/auth/auth';

export const dynamic = 'force-dynamic';

export const GET = handleAuth;
export const POST = handleAuth;
