'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { acceptInvitationAction } from '@/server/actions/team';

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      pending={pending}
      onClick={() =>
        start(async () => {
          const result = await acceptInvitationAction({ token });
          if (result.ok) {
            toast.success('Welcome aboard');
            router.push(`/w/${result.data.workspaceSlug}`);
          } else toast.error(result.error);
        })
      }
    >
      {pending ? 'Joining…' : 'Accept invitation'}
    </Button>
  );
}
