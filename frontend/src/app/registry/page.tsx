export default function RegistryPage() {
  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      <div className="mb-8">
        <nav className="flex items-center gap-2 mb-2">
          <span className="text-[13px] text-grey-500">Admin</span>
          <span className="material-symbols-outlined text-[14px] text-grey-300">chevron_right</span>
          <span className="text-[13px] font-medium text-primary">Source Registry</span>
        </nav>
        <h1 className="text-[20px] font-bold text-primary">Source Registry</h1>
        <p className="text-[13px] text-grey-500 mt-1">
          Manage scrape sources — add new verticals or update selectors without code changes.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-grey-100 shadow-[0_1px_3px_rgba(27,45,91,0.08)] p-12 flex flex-col items-center justify-center text-center">
        <span className="material-symbols-outlined text-grey-200 text-[64px] mb-4">database</span>
        <h2 className="text-[16px] font-semibold text-grey-500 mb-2">Source Registry</h2>
        <p className="text-[13px] text-grey-400 max-w-xs">
          This panel will list and manage <code>source_registry</code> DB rows once the database
          layer is connected. Today the registry lives in{" "}
          <code>backend/src/config/sourceRegistry.ts</code>.
        </p>
      </div>
    </div>
  );
}
