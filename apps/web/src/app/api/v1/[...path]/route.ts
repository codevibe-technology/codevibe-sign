import { handleSignRequest } from '@/server/sign/server';

export const dynamic = 'force-dynamic';

export const GET = handleSignRequest;
export const HEAD = handleSignRequest;
export const POST = handleSignRequest;
export const PATCH = handleSignRequest;
export const PUT = handleSignRequest;
export const DELETE = handleSignRequest;
