export default function SettingsPage() {
  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      <div className="mb-8">
        <h1 className="text-[20px] font-bold text-primary">Settings</h1>
        <p className="text-[13px] text-grey-500 mt-1">
          Platform configuration — suppression lists, warm-up phases, API keys.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-grey-100 shadow-[0_1px_3px_rgba(27,45,91,0.08)] p-12 flex flex-col items-center justify-center text-center">
        <span className="material-symbols-outlined text-grey-200 text-[64px] mb-4">settings</span>
        <h2 className="text-[16px] font-semibold text-grey-500 mb-2">Settings</h2>
        <p className="text-[13px] text-grey-400 max-w-xs">
          Settings management will be available once the database and admin API routes are connected.
        </p>
      </div>
    </div>
  );
}
