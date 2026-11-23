import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="mb-6 h-8 w-56" />
      <Skeleton className="mb-6 h-8 w-full" />
      <Card className="h-64" />
    </div>
  );
}
