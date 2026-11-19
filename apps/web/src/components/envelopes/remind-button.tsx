'use client';

import { BellRing } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { remindAction } from '@/server/actions/envelopes';

/** Mails a fresh signing link: to one recipient, or to everyone whose turn it is. */
export function RemindButton({
  workspaceId,
  envelopeId,
  recipientId,
  label = 'Remind',
  success = 'Reminder sent with a fresh signing link',
  variant = 'secondary',
  size = 'sm',
}: {
  workspaceId: string;
  envelopeId: string;
  recipientId?: string;
  label?: string;
  success?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      pending={pending}
      onClick={() =>
        start(async () => {
          const result = await remindAction({
            workspaceId,
            envelopeId,
            ...(recipientId ? { recipientId } : {}),
          });
          if (result.ok) {
            toast.success(success);
            router.refresh();
          } else toast.error(result.error);
        })
      }
    >
      <BellRing aria-hidden className="h-4 w-4" />
      {label}
    </Button>
  );
}
