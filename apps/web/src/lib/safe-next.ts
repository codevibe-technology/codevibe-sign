/** Where the signed-in app starts. It picks the workspace, or onboarding without one. */
export const APP_HOME = '/dashboard';

/**
 * A same-site path to go to after sign-in. Anything else, and the public home page itself,
 * becomes the dashboard: signing in never ends on the marketing site.
 */
export function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return APP_HOME;
  }
  return next === '/' ? APP_HOME : next;
}
