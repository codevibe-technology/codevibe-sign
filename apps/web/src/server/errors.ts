export type AppErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'PLAN_LIMIT';

/**
 * A failure the person can act on. `field` names the form field to fix, so the form can put the
 * message next to it.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly field: string | undefined;

  constructor(code: AppErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.field = field;
  }
}
