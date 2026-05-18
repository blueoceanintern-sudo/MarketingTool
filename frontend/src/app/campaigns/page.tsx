import Link from "next/link";
import { getCampaigns } from "@/lib/api";
import type { Campaign, CampaignStatus } from "@/lib/api";

const statusConfig: Record<CampaignStatus | "error", { label: string; className: string }> = {
  active:   { label: "Active",    className: "bg-success-bg text-success" },
  paused:   { label: "Paused",   className: "bg-neutral-bg text-neutral" },
  draft:    { label: "Draft",    className: "bg-neutral-bg text-neutral" },
  error:    { label: "Error",    className: "bg-danger-bg text-danger" },
  complete: { label: "Complete", className: "bg-grey-100 text-grey-500" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  const totalLeads = campaigns.reduce((s, c) => s + c.leads_count, 0);
  const avgOpenRate = campaigns.length
    ? Math.round(campaigns.reduce((s, c) => s + c.open_rate, 0) / campaigns.length * 10) / 10
    : 0;
  const totalSent = campaigns.reduce((s, c) => s + c.sent, 0);
  const totalPending = campaigns.reduce((s, c) => s + c.drafts_pending, 0);

  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <span className="text-[13px] text-grey-500">Marketing</span>
            <span className="material-symbols-outlined text-[14px] text-grey-300">chevron_right</span>
            <span className="text-[13px] font-medium text-primary">Campaigns</span>
          </nav>
          <h2 className="text-[20px] font-bold text-primary">Campaigns</h2>
          <p className="text-[13px] text-grey-500 mt-1">
            Manage and monitor your outreach campaigns across Singapore, Australia, and the US.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 px-4 py-2 border border-grey-100 rounded-lg text-[14px] font-semibold text-primary hover:bg-grey-50 transition-colors duration-150">
            <span className="material-symbols-outlined text-[20px]">file_download</span>
            Export
          </button>
          <button className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold shadow-[0_1px_3px_rgba(27,45,91,0.08)] active:scale-[0.98] transition-transform">
            <span className="material-symbols-outlined text-[20px]">add</span>
            New Campaign
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Active Leads</p>
          <div className="flex items-baseline justify-between mt-2">
            <h3 className="text-[24px] font-bold text-primary font-mono">{totalLeads.toLocaleString()}</h3>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Avg. Open Rate</p>
          <div className="flex items-baseline justify-between mt-2">
            <h3 className="text-[24px] font-bold text-primary font-mono">{avgOpenRate}%</h3>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Total Sent</p>
          <div className="flex items-baseline justify-between mt-2">
            <h3 className="text-[24px] font-bold text-primary font-mono">{totalSent.toLocaleString()}</h3>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Pending Drafts</p>
          <div className="flex items-baseline justify-between mt-2">
            <h3 className={`text-[24px] font-bold font-mono ${totalPending > 0 ? "text-warning" : "text-primary"}`}>
              {totalPending}
            </h3>
            {totalPending > 0 && (
              <span className="px-2 py-0.5 bg-warning-bg text-warning text-xs font-bold rounded-full">
                Requires Action
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-grey-100 flex justify-between items-center bg-grey-50">
          <div className="flex gap-4">
            <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-grey-100 rounded text-[13px] font-medium text-primary">
              <span className="material-symbols-outlined text-[18px] text-grey-500">filter_alt</span>
              All Statuses
            </button>
          </div>
          <p className="text-[13px] text-grey-500">Showing {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</p>
        </div>

        {campaigns.length === 0 ? (
          <div className="px-6 py-16 text-center text-grey-400 text-[14px]">No campaigns yet.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="bg-grey-50">
              <tr className="text-left border-b border-grey-100">
                <th className="px-6 py-4 text-[14px] font-semibold text-primary">Name</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary">Vertical</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary text-center">Geography</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary text-center">Status</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary text-right">Leads</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary text-center">Drafts Pending</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary text-right">Sent</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary text-right">Open Rate</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-primary">Created</th>
                <th className="px-6 py-4 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {campaigns.map((c) => {
                const badge = statusConfig[c.status] ?? statusConfig.draft;
                return (
                  <tr key={c.id} className="hover:bg-ocean-wash transition-colors duration-150">
                    <td className="px-6 py-[11px]">
                      <Link href={`/campaigns/${c.id}`} className="font-bold text-primary hover:underline block">
                        {c.name}
                      </Link>
                      <span className="text-[11px] text-grey-500">ID: {c.id.slice(0, 8)}…</span>
                    </td>
                    <td className="px-4 py-[11px] text-[13px] text-grey-700">{c.vertical}</td>
                    <td className="px-4 py-[11px] text-center">
                      <div className="flex justify-center gap-1 flex-wrap">
                        {c.geography.map((geo) => (
                          <span key={geo} className="px-2 py-0.5 bg-secondary-fixed text-on-secondary-fixed-variant text-[10px] font-bold rounded">
                            {geo}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-[11px] text-center">
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-[11px] text-right text-[13px] text-grey-700 font-mono">
                      {c.leads_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-[11px] text-center">
                      {c.drafts_pending > 0 ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-warning-bg text-warning font-bold text-xs rounded-full">
                          {c.drafts_pending}
                          <span className="material-symbols-outlined text-[12px]">priority_high</span>
                        </span>
                      ) : (
                        <span className="text-[13px] font-medium text-grey-300">0</span>
                      )}
                    </td>
                    <td className="px-4 py-[11px] text-right text-[13px] text-grey-700 font-mono">
                      {c.sent.toLocaleString()}
                    </td>
                    <td className="px-4 py-[11px] text-right text-[13px] font-bold text-primary font-mono">
                      {c.open_rate}%
                    </td>
                    <td className="px-4 py-[11px] text-[13px] text-grey-500">{formatDate(c.created_at)}</td>
                    <td className="px-6 py-[11px] text-right">
                      <button className="material-symbols-outlined text-grey-500 hover:text-primary cursor-pointer active:scale-90 transition-all">
                        more_vert
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
