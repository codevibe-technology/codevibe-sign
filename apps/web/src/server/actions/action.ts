import 'server-only';
import { z } from 'zod';
import { can, canManageBilling, type Permission, type Role } from '@/lib/roles';
import { db } from '../db';
import { AppError, type AppErrorCode } from '../errors';
import type { PlanLimitDetails } from '../plans';
import { getSessionUser, type SessionUser } from '../auth/session';
import { accountOfWorkspace } from '../accounts';
import { findMembership, type Workspace } from '../workspaces';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: AppErrorCode | 'INTERNAL';
      error: string;
      field?: string;
      /** Set with `PLAN_LIMIT`: the limit that was met, for an upgrade prompt. */
      limit?: PlanLimitDetails;
    };

export interface ActionContext {
  user: SessionUser;
  workspace: Workspace;
  role: Role;
}

const workspaceInput = z.object({ workspaceId: z.string().min(1).max(64) });

const fail = (code: AppErrorCode | 'INTERNAL', error: string, field?: string) =>
  ({ ok: false, code, error, ...(field ? { field } : {}) }) as const;

const hasLimitDetails = (err: AppError): err is AppError & { details(): PlanLimitDetails } =>
  typeof (err as { details?: unknown }).details === 'function';

/** FormData from a form, or a plain object from code, as one object to validate. */
function toObject(input: unknown): unknown {
  if (input instanceof FormData) {
    const out: Record<string, FormDataEntryValue> = {};
    for (const [key, value] of input.entries()) out[key] = value;
    return out;
  }
  return input;
}

async function run<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (err) {
    if (err instanceof AppError && err.code === 'PLAN_LIMIT' && hasLimitDetails(err)) {
      return { ...fail(err.code, err.message, err.field), limit: err.details() };
    }
    if (err instanceof AppError) return fail(err.code, err.message, err.field);
    console.error('action failed', err instanceof Error ? err.message : err);
    return fail('INTERNAL', 'Something went wrong on our side. Try again in a moment.');
  }
}

function firstIssue(error: z.ZodError) {
  const issue = error.issues[0];
  return fail('VALIDATION', issue?.message ?? 'Check the form', issue?.path.join('.') || undefined);
}

/**
 * A server action that acts in a workspace. In order: a signed-in user, their membership of
 * the workspace named by `workspaceId` (anything else looks like a missing workspace), the
 * permission, then the input. The handler runs only when all four pass.
 */
export function workspaceAction<S extends z.ZodObject, T>(
  permission: Permission,
  schema: S,
  handler: (ctx: ActionContext, input: z.infer<S>) => Promise<T>,
) {
  return async (raw: unknown): Promise<ActionResult<T>> => {
    const user = await getSessionUser();
    if (!user) return fail('UNAUTHORIZED', 'Your session has ended. Sign in again.');
    const values = toObject(raw);
    const target = workspaceInput.safeParse(values);
    if (!target.success) return fail('NOT_FOUND', 'Workspace not found');
    const membership = await findMembership(db(), user.id, { id: target.data.workspaceId });
    if (!membership) return fail('NOT_FOUND', 'Workspace not found');
    if (!can(membership.role, permission)) {
      return fail('FORBIDDEN', 'Your role does not allow this. Ask an admin of the workspace.');
    }
    const parsed = schema.safeParse(values);
    if (!parsed.success) return firstIssue(parsed.error);
    return run(() =>
      handler({ user, workspace: membership.workspace, role: membership.role }, parsed.data),
    );
  };
}

export interface AccountContext extends ActionContext {
  /** The account the workspace belongs to, which the signed-in person owns. */
  accountId: string;
}

/**
 * A server action on what an account holds: its plan, payments, invoices, eSign credits and
 * own provider account. Everything `workspaceAction` checks, and then that the signed-in
 * person owns the account of that workspace. An admin or another owner of the workspace is
 * refused: the account pays, so only its owner decides. With `billing.manage`, a billing
 * admin of the workspace may act too.
 */
export function accountAction<S extends z.ZodObject, T>(
  permission: Permission,
  schema: S,
  handler: (ctx: AccountContext, input: z.infer<S>) => Promise<T>,
) {
  return workspaceAction(permission, schema, async (ctx, input) => {
    const account = await accountOfWorkspace(db(), ctx.workspace.id);
    const holds = account.ownerUserId === ctx.user.id;
    if (permission === 'billing.manage' ? !canManageBilling(ctx.role, holds) : !holds) {
      throw new AppError(
        'FORBIDDEN',
        permission === 'billing.manage'
          ? 'Only the account owner or a billing admin can do this. Ask the owner to make you a billing admin in Settings, Team.'
          : 'Only the owner of this account can do this. Ask the person whose plan this workspace is on.',
      );
    }
    return handler({ ...ctx, accountId: account.id }, input);
  });
}

/** A server action for the signed-in user, outside any workspace. */
export function userAction<S extends z.ZodType, T>(
  schema: S,
  handler: (user: SessionUser, input: z.infer<S>) => Promise<T>,
) {
  return async (raw: unknown): Promise<ActionResult<T>> => {
    const user = await getSessionUser();
    if (!user) return fail('UNAUTHORIZED', 'Your session has ended. Sign in again.');
    const parsed = schema.safeParse(toObject(raw));
    if (!parsed.success) return firstIssue(parsed.error);
    return run(() => handler(user, parsed.data));
  };
}

/** A server action for someone who is not signed in yet. The handler checks what it needs. */
export function publicAction<S extends z.ZodType, T>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<T>,
) {
  return async (raw: unknown): Promise<ActionResult<T>> => {
    const parsed = schema.safeParse(toObject(raw));
    if (!parsed.success) return firstIssue(parsed.error);
    return run(() => handler(parsed.data));
  };
}
