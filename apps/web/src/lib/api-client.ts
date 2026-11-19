/** A refusal from the sign API, with the request field it points at when there is one. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: { issues?: { path?: string; message?: string }[] };
  };
}

/**
 * Calls the workspace's sign API from the browser as the signed-in member. The session cookie
 * goes along; `X-Workspace` names the workspace, as the API requires for session calls.
 */
export async function apiFetch<T>(
  workspaceId: string,
  path: `/v1/${string}`,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-workspace', workspaceId);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(
      'NETWORK',
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as ErrorBody;
  const issue = body.error?.details?.issues?.[0];
  const message =
    res.status === 401
      ? 'Your session has ended. Sign in again in another tab, then retry.'
      : res.status === 403
        ? (body.error?.message ?? 'Your role does not allow this.')
        : res.status === 413
          ? 'The files are too large. Each PDF can be up to 20 MB.'
          : res.status >= 500
            ? 'Something went wrong on our side. Try again in a moment.'
            : (issue?.message ?? body.error?.message ?? 'The request was refused.');
  throw new ApiError(body.error?.code ?? 'HTTP', message, res.status, issue?.path);
}

export const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
