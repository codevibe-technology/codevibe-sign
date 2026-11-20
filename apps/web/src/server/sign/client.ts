import 'server-only';
import type { Principal } from '@codevibe_technology/sign-server';
import { env } from '../env';
import { inProcess } from './principal';
import { SIGN_BASE_PATH, signServer } from './server';

/**
 * Calls the sign API from server code as `principal`, without a network hop. The principal is
 * attached to this exact `Request` object, so nothing arriving over HTTP can claim it.
 *
 *   const res = await signRequest({ id: `user:${user.id}`, workspaceId }, '/v1/envelopes');
 */
export async function signRequest(
  principal: Principal,
  path: `/v1/${string}`,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(`${env().APP_URL}${SIGN_BASE_PATH}${path}`, await withLength(init));
  inProcess.set(request, principal);
  return signServer().app.fetch(request);
}

/**
 * Gives a form body a known length. Without one the server's body-size check wraps the request
 * in a new object, and the principal attached to this one would be lost.
 */
async function withLength(init?: RequestInit): Promise<RequestInit | undefined> {
  if (!(init?.body instanceof FormData)) return init;
  const encoded = new Response(init.body);
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const headers = new Headers(init.headers);
  headers.set('content-type', encoded.headers.get('content-type')!);
  headers.set('content-length', String(bytes.length));
  return { ...init, headers, body: bytes };
}
