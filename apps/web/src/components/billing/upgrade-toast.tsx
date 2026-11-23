'use client';

import { toast } from 'sonner';
import type { ActionResult } from '@/server/actions/action';
import { UpgradePrompt } from './upgrade-prompt';

/** The workspace of the page the person is on, from its address. */
function currentSlug(): string | undefined {
  return /^\/dashboard\/([^/]+)/.exec(window.location.pathname)?.[1];
}

/**
 * Shows a failed action. A plan limit gets the upgrade prompt, which stays until it is
 * closed and leads to the Plan and usage page; anything else is a plain error. Returns true
 * when it showed the prompt.
 */
export function showActionError(result: Extract<ActionResult<unknown>, { ok: false }>): boolean {
  if (result.code !== 'PLAN_LIMIT') {
    toast.error(result.error);
    return false;
  }
  toast.custom(
    () => (
      <UpgradePrompt
        message={result.error}
        limit={result.limit}
        slug={currentSlug()}
        className="w-[min(92vw,26rem)] bg-surface shadow-card"
      />
    ),
    { duration: 15_000, id: 'plan-limit' },
  );
  return true;
}
