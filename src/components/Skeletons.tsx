export function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <span className="sr-only">불러오는 중입니다.</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="app-card overflow-hidden">
          <div className="skeleton aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 px-4 py-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">불러오는 중입니다.</span>
      <div className="skeleton h-48 w-full sm:h-64" />
      <div className="space-y-2">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-4 w-64" />
      </div>
      <CardGridSkeleton />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">불러오는 중입니다.</span>
      <div className="skeleton h-3 w-28" />
      <div className="skeleton h-7 w-2/3" />
      <div className="skeleton aspect-[4/3] w-full max-w-2xl" />
      <div className="skeleton h-4 w-full max-w-2xl" />
      <div className="skeleton h-4 w-5/6 max-w-2xl" />
    </div>
  );
}
