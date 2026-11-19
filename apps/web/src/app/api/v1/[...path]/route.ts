import { recordCreatedEnvelope } from '@/server/sign/senders';
import { handleSignRequest } from '@/server/sign/server';

export const dynamic = 'force-dynamic';

export const GET = handleSignRequest;
export const HEAD = handleSignRequest;
export const PATCH = handleSignRequest;
export const PUT = handleSignRequest;
export const DELETE = handleSignRequest;

export async function POST(request: Request) {
  const workspaceId = request.headers.get('x-workspace');
  // Only session calls name their workspace this way; an API key call is the key's, not a person's.
  const creates =
    workspaceId !== null &&
    !request.headers.has('authorization') &&
    new URL(request.url).pathname === '/api/v1/envelopes';
  const response = await handleSignRequest(request);
  if (creates && response.status === 201) await recordCreatedEnvelope(workspaceId, response);
  return response;
}
