'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusPage } from '@/components/shell/status-page';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPage
      icon={TriangleAlert}
      title="Something went wrong"
      description={
        <>
          The page did not load. Try again; if it keeps happening, tell your admin
          {error.digest ? (
            <>
              {' '}
              and quote <code className="rounded bg-surface-2 px-1">{error.digest}</code>
            </>
          ) : null}
          .
        </>
      }
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" asChild>
            <Link href="/">Go to my workspace</Link>
          </Button>
        </div>
      }
    />
  );
}
