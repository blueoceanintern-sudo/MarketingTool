export default function AnalyticsLoading() {
  return (
    <div className="p-10 max-w-[1600px] mx-auto animate-pulse">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div className="space-y-2">
          <div className="h-7 w-56 bg-grey-100 rounded" />
          <div className="h-4 w-80 bg-grey-50 rounded" />
        </div>
        <div className="h-9 w-32 bg-grey-100 rounded-lg" />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
            <div className="flex justify-between items-start mb-2">
              <div className="h-3 w-28 bg-grey-100 rounded" />
              <div className="h-5 w-5 bg-grey-100 rounded" />
            </div>
            <div className="h-8 w-20 bg-grey-100 rounded mt-3 mb-3" />
            <div className="h-3 w-24 bg-grey-50 rounded" />
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-12 gap-8 mb-8">
        <div className="col-span-8 bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
          <div className="h-5 w-48 bg-grey-100 rounded mb-6" />
          <div className="h-[280px] w-full bg-grey-50 rounded" />
          <div className="flex justify-between mt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 w-8 bg-grey-100 rounded" />
            ))}
          </div>
        </div>
        <div className="col-span-4 bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
          <div className="h-5 w-36 bg-grey-100 rounded mb-6" />
          <div className="space-y-6 mt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="flex justify-between mb-1">
                  <div className="h-3 w-20 bg-grey-100 rounded" />
                  <div className="h-3 w-10 bg-grey-100 rounded" />
                </div>
                <div className="w-full bg-grey-100 h-2 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
