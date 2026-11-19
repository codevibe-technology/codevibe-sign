import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusPage } from '@/components/shell/status-page';

export default function NotFound() {
  return (
    <StatusPage
      icon={SearchX}
      title="We could not find that page"
      description="It may have moved, or you may not have access to it. Check the link, or go back to your workspace."
      action={
        <Button asChild>
          <Link href="/">Go to my workspace</Link>
        </Button>
      }
    />
  );
}
