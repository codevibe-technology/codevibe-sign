import { HttpError, type Principal } from '@codevibe_technology/sign-server';
import { can, canVoidEnvelope, type Role } from '@/lib/roles';

export const WORKSPACE_HEADER = 'x-workspace';

export interface PrincipalDeps {
  appUrl: string;
  /** The live key's id and workspace, or null. */
  resolveApiKey: (key: string) => Promise<{ id: string; workspaceId: string } | null>;
  /** The signed-in user behind the request's session cookie, or null. */
  sessionUser: (headers: Headers) => Promise<{ id: string } | null>;
  /** The user's role in the workspace, or null when they are not a member. */
  roleOf: (userId: string, workspaceId: string) => Promise<Role | null>;
  /** Whether the member sent this envelope from the app; see `canVoidEnvelope`. */
  isSender?: (userId: string, workspaceId: string, envelopeId: string) => Promise<boolean>;
}

/** Principals for calls made in this process; see `signRequest`. */
export const inProcess = new WeakMap<Request, Principal>();

const SAFE_METHODS = new Set(['GET', 'HEAD']);
const VOID_PATH = /\/v1\/envelopes\/([^/]+)\/void\/?$/;

/**
 * Resolves who is calling `/api/v1`: an in-process call, a workspace API key, or a signed-in
 * member using the app. A session call must name its workspace in `X-Workspace` (a header no
 * other site can send without a CORS preflight) and, when it writes, come from the app's own
 * origin. Viewers get a read-only principal, and members may only void what they sent.
 */
export function createAuthenticate(deps: PrincipalDeps) {
  const appOrigin = new URL(deps.appUrl).origin;
  return async (request: Request): Promise<Principal | null> => {
    const local = inProcess.get(request);
    if (local) return local;

    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (bearer) {
      const key = await deps.resolveApiKey(bearer);
      if (!key) throw new HttpError('UNAUTHORIZED', 'The API key is not valid or was revoked');
      return { id: key.id, workspaceId: key.workspaceId };
    }

    const workspaceId = request.headers.get(WORKSPACE_HEADER);
    if (!workspaceId) return null;
    if (!SAFE_METHODS.has(request.method) && request.headers.get('origin') !== appOrigin) {
      throw new HttpError('FORBIDDEN', 'Requests must come from the app itself');
    }
    const user = await deps.sessionUser(request.headers);
    if (!user) throw new HttpError('UNAUTHORIZED', 'Sign in to continue');
    const role = await deps.roleOf(user.id, workspaceId);
    if (!role) throw new HttpError('UNAUTHORIZED', 'You are not a member of this workspace');
    const voiding = request.method === 'POST' && VOID_PATH.exec(new URL(request.url).pathname);
    if (voiding && can(role, 'envelopes.write')) {
      const envelopeId = decodeURIComponent(voiding[1]!);
      const own = (await deps.isSender?.(user.id, workspaceId, envelopeId)) ?? false;
      if (!canVoidEnvelope(role, own)) {
        throw new HttpError('FORBIDDEN', 'Only an admin can void an envelope someone else sent');
      }
    }
    return {
      id: `user:${user.id}`,
      workspaceId,
      readOnly: !can(role, 'envelopes.write'),
    };
  };
}
