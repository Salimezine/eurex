interface Props {
  className?: string;
}

export default function Skeleton({ className = '' }: Props) {
  return <div className={`bg-gray-200 animate-pulse rounded ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

export function SkeletonKpiGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border rounded-xl p-4 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? 'w-32' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border rounded-xl p-4 space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDossier() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="ml-auto bg-white border rounded-2xl px-4 py-3 flex items-center gap-4">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-14" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>
      <SkeletonRows rows={9} cols={5} />
    </div>
  );
}

export function SkeletonSection() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-40" />
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <Skeleton className="h-4 w-36" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonAuth() {
  return (
    <div className="flex-1 bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border p-8 w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}
