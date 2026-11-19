/**
 * The workspace of everything created before workspaces existed, and of every API key
 * configured without one. A single-tenant server never sees any other.
 */
export const DEFAULT_WORKSPACE = 'default';

/** Who is calling a sender route, and which workspace they act in. */
export interface Principal {
  /** Stable and unique across workspaces; scopes idempotency keys and rate limits. Never a secret. */
  id: string;
  workspaceId: string;
  /** Only `GET` routes are allowed, for example for a viewer. */
  readOnly?: boolean;
}

/** Idempotency and rate-limit keys for a principal; unchanged for the default workspace. */
export function principalScope(principal: Principal): string {
  return principal.workspaceId === DEFAULT_WORKSPACE
    ? `key:${principal.id}`
    : `ws:${principal.workspaceId}:${principal.id}`;
}
