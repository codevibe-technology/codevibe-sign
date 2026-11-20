import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function HeaderSkeleton() {
  return (
    <div className="mb-7 space-y-2.5 border-b border-line pb-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading the dashboard">
      <HeaderSkeleton />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-10" />
            <Skeleton className="h-3 w-12" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="space-y-4 p-5 lg:col-span-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </Card>
        <Card className="h-56 lg:col-span-2" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="divide-y divide-line" role="status" aria-label="Loading envelopes">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-4 w-4" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3 max-w-sm" />
            <Skeleton className="h-3 w-1/3 max-w-48" />
          </div>
          <Skeleton className="hidden h-5 w-24 sm:block" />
          <Skeleton className="hidden h-4 w-16 md:block" />
        </div>
      ))}
    </Card>
  );
}

export function ListSkeleton() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-10 w-40" />
      </div>
      <TableSkeleton />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading the envelope">
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="space-y-3 p-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </Card>
          <Card className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </Card>
        </div>
        <Card className="h-64" />
      </div>
    </div>
  );
}
