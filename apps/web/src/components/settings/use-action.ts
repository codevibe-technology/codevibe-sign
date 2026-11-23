'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { showActionError } from '@/components/billing/upgrade-toast';
import type { ActionResult } from '@/server/actions/action';

/**
 * Runs a server action, shows a toast for the outcome, and keeps a failed field's message so
 * the form can show it next to that field. A plan limit shows the upgrade prompt.
 */
export function useAction() {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function run<T>(
    call: () => Promise<ActionResult<T>>,
    options: { success?: string; onSuccess?: (data: T) => void } = {},
  ) {
    start(async () => {
      const result = await call();
      if (result.ok) {
        setErrors({});
        if (options.success) toast.success(options.success);
        options.onSuccess?.(result.data);
        return;
      }
      if (result.field) setErrors({ [result.field]: result.error });
      // A plan limit also gets the upgrade prompt, wherever the form shows the message.
      if (!result.field || result.code === 'PLAN_LIMIT') showActionError(result);
    });
  }

  return { pending, errors, run, clear: () => setErrors({}) };
}
