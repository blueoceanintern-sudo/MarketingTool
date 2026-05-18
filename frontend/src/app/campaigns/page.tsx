import Link from "next/link";

type CampaignStatus = "active" | "paused" | "draft" | "error" | "complete";

interface Campaign {
  id: string;
  name: string;
  vertical: string;
  geos: string[];
  status: CampaignStatus;
  leads: number;
  draftsPending: number;
  sent: number;
  openRate: number;
  created: string;
}

const campaigns: Campaign[] = [
  {
    id: "CAM-9241",
    name: "Q3 APAC SaaS Prospecting",
    vertical: "Software / IT",
    geos: ["SG", "AU"],
    status: "active",
    leads: 4281,
    draftsPending: 0,
    sent: 12402,
    openRate: 52.4,
    created: "Oct 12, 2023",
  },
  {
    id: "CAM-9245",
    name: "US Enterprise FinTech Q4",
    vertical: "Finance",
    geos: ["US"],
    status: "paused",
    leads: 8920,
    draftsPending: 12,
    sent: 34118,
    openRate: 38.1,
    created: "Oct 14, 2023",
  },
  {
    id: "CAM-9248",
    name: "Healthcare Outreach - UK/EU",
    vertical: "Healthcare",
    geos: ["UK", "DE"],
    status: "active",
    leads: 2150,
    draftsPending: 0,
    sent: 5820,
    openRate: 45.2,
    created: "Oct 18, 2023",
  },
  {
    id: "CAM-9252",
    name: "Retargeting Lead Gen - AU",
    vertical: "E-commerce",
    geos: ["AU"],
    status: "error",
    leads: 1200,
    draftsPending: 84,
    sent: 2400,
    openRate: 12.1,
    created: "Oct 20, 2023",
  },
  {
    id: "CAM-9255",
    name: "Direct Mail Sync - SG",
    vertical: "Logistics",
    geos: ["SG"],
    status: "active",
    leads: 540,
    draftsPending: 0,
    sent: 1080,
    openRate: 61.9,
    created: "Oct 22, 2023",
  },
];

const statusConfig: Record<CampaignStatus, { label: string; className: string }> = {
  active:   { label: "Active",    className: "bg-success-bg text-success" },
  paused:   { label: "Paused",   className: "bg-neutral-bg text-neutral" },
  draft:    { label: "Draft",    className: "bg-neutral-bg text-neutral" },
  error:    { label: "Error",    className: "bg-danger-bg text-danger" },
  complete: { label: "Complete", className: "bg-grey-100 text-grey-500" },
};

export default function CampaignsPage() {
  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <span className="text-[13px] text-grey-500">Marketing</span>
            <span className="material-symbols-outlined text-[14px] text-grey-300">
              chevron_right
            </span>
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
            <h3 className="text-[24px] font-bold text-primary font-mono">12,482</h3>
            <span className="flex items-center gap-1 text-[13px] font-medium text-success">
              +12%
              <span className="material-symbols-outlined text-[14px]">trending_up</span>
            </span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Avg. Open Rate</p>
          <div className="flex items-baseline justify-between mt-2">
            <h3 className="text-[24px] font-bold text-primary font-mono">42.8%</h3>
            <span className="flex items-center gap-1 text-[13px] font-medium text-success">
              +2.4%
              <span className="material-symbols-outlined text-[14px]">trending_up</span>
            </span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Total Sent</p>
          <div className="flex items-baseline justify-between mt-2">
            <h3 className="text-[24px] font-bold text-primary font-mono">84.2k</h3>
            <span className="text-[13px] font-medium text-grey-500">This month</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Pending Drafts</p>
          <div className="flex items-baseline justify-between mt-2">
            <h3 className="text-[24px] font-bold text-warning font-mono">142</h3>
            <span className="px-2 py-0.5 bg-warning-bg text-warning text-xs font-bold rounded-full">
              Requires Action
            </span>
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-grey-100 flex justify-between items-center bg-grey-50">
          <div className="flex gap-4">
            <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-grey-100 rounded text-[13px] font-medium text-primary">
              <span className="material-symbols-outlined text-[18px] text-grey-500">filter_alt</span>
              All Statuses
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-grey-100 rounded text-[13px] font-medium text-primary">
              <span className="material-symbols-outlined text-[18px] text-grey-500">public</span>
              Geography
            </button>
          </div>
          <p className="text-[13px] text-grey-500">Showing 1–5 of 42 campaigns</p>
        </div>

        <table className="w-full border-collapse">
          <thead className="bg-grey-50">
            <tr className="text-left border-b border-grey-100">
              <th className="px-6 py-4 text-[14px] font-semibold text-primary">Name</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Vertical</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary text-center">Geography</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary text-center">Status</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary text-right">Leads</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary text-center">
                Drafts Pending
              </th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary text-right">Sent</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary text-right">
                Open Rate
              </th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Created</th>
              <th className="px-6 py-4 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-grey-100">
            {campaigns.map((c) => {
              const badge = statusConfig[c.status];
              return (
                <tr
                  key={c.id}
                  className="hover:bg-ocean-wash transition-colors duration-150"
                >
                  <td className="px-6 py-[11px]">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="font-bold text-primary hover:underline block"
                    >
                      {c.name}
                    </Link>
                    <span className="text-[11px] text-grey-500">ID: {c.id}</span>
                  </td>
                  <td className="px-4 py-[11px] text-[13px] text-grey-700">{c.vertical}</td>
                  <td className="px-4 py-[11px] text-center">
                    <div className="flex justify-center gap-1">
                      {c.geos.map((geo) => (
                        <span
                          key={geo}
                          className="px-2 py-0.5 bg-secondary-fixed text-on-secondary-fixed-variant text-[10px] font-bold rounded"
                        >
                          {geo}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-[11px] text-center">
                    <span
                      className={`px-2.5 py-1 text-xs font-bold rounded-full ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-[11px] text-right text-[13px] text-grey-700 font-mono">
                    {c.leads.toLocaleString()}
                  </td>
                  <td className="px-4 py-[11px] text-center">
                    {c.draftsPending > 0 ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 bg-warning-bg text-warning font-bold text-xs rounded-full">
                        {c.draftsPending}
                        <span className="material-symbols-outlined text-[12px]">
                          priority_high
                        </span>
                      </span>
                    ) : (
                      <span className="text-[13px] font-medium text-grey-300">0</span>
                    )}
                  </td>
                  <td className="px-4 py-[11px] text-right text-[13px] text-grey-700 font-mono">
                    {c.sent.toLocaleString()}
                  </td>
                  <td className="px-4 py-[11px] text-right text-[13px] font-bold text-primary font-mono">
                    {c.openRate}%
                  </td>
                  <td className="px-4 py-[11px] text-[13px] text-grey-500">{c.created}</td>
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

        {/* Pagination */}
        <div className="px-5 py-4 bg-grey-50 border-t border-grey-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-grey-500">Rows per page:</span>
            <select className="bg-white border border-grey-100 rounded px-2 py-1 text-[13px] outline-none">
              <option>10</option>
              <option>20</option>
              <option>50</option>
            </select>
          </div>
          <div className="flex items-center gap-4">
            <button className="material-symbols-outlined text-grey-300 cursor-not-allowed">
              chevron_left
            </button>
            <div className="flex items-center gap-2">
              <button className="w-8 h-8 rounded bg-primary text-white text-[13px] font-medium">
                1
              </button>
              <button className="w-8 h-8 rounded hover:bg-grey-100 text-grey-700 text-[13px] font-medium">
                2
              </button>
              <button className="w-8 h-8 rounded hover:bg-grey-100 text-grey-700 text-[13px] font-medium">
                3
              </button>
              <span className="text-grey-300">…</span>
              <button className="w-8 h-8 rounded hover:bg-grey-100 text-grey-700 text-[13px] font-medium">
                5
              </button>
            </div>
            <button className="material-symbols-outlined text-grey-700 hover:text-primary transition-colors duration-150">
              chevron_right
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
