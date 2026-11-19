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
  const request = new Request(`${env().APP_URL}${SIGN_BASE_PATH}${path}`, init);
  inProcess.set(request, principal);
  return signServer().app.fetch(request);
}
