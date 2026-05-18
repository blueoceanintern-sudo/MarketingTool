import Link from "next/link";
import { getCampaign, getLeads } from "@/lib/api";
import type { Lead } from "@/lib/api";

const AVATAR_COLORS = [
  "bg-primary-fixed text-on-primary-fixed",
  "bg-secondary-fixed text-on-secondary-fixed-variant",
  "bg-[#ffdcc1] text-[#2e1500]",
  "bg-ocean-wash text-primary",
  "bg-primary-container text-white",
];

function initials(lead: Lead) {
  return `${lead.first_name?.[0] ?? ""}${lead.last_name?.[0] ?? ""}`.toUpperCase() || "?";
}

const statusMap: Record<string, { label: string; className: string }> = {
  new:        { label: "New",        className: "bg-neutral-bg text-neutral" },
  contacted:  { label: "Contacted",  className: "bg-ocean-wash text-primary" },
  replied:    { label: "Replied",    className: "bg-warning-bg text-warning" },
  converted:  { label: "Converted",  className: "bg-success-bg text-success" },
  suppressed: { label: "Suppressed", className: "bg-danger-bg text-danger" },
};

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, leads] = await Promise.all([getCampaign(id), getLeads(id)]);

  const name = campaign?.name ?? "Campaign";

  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <Link href="/campaigns" className="text-[13px] text-grey-500 hover:text-primary transition-colors">
              Campaigns
            </Link>
            <span className="material-symbols-outlined text-[16px] text-grey-300">chevron_right</span>
            <span className="text-[13px] font-medium text-primary">{name}</span>
          </nav>
          <h2 className="text-[20px] font-bold text-primary">{name}</h2>
          <p className="text-[11px] text-grey-500 mt-1">ID: {id}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border border-grey-300 rounded-lg text-[14px] font-semibold text-grey-700 hover:bg-grey-50 transition-colors duration-150">
            <span className="material-symbols-outlined text-[20px]">file_download</span>
            Export CSV
          </button>
          {campaign?.status === "active" && (
            <button className="flex items-center gap-2 px-4 py-2 border border-danger rounded-lg text-[14px] font-semibold text-danger hover:bg-danger-bg transition-colors duration-150">
              <span className="material-symbols-outlined text-[20px]">pause_circle</span>
              Pause Campaign
            </button>
          )}
        </div>
      </div>

      {/* KPI grid */}
      {campaign && (
        <div className="grid grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-ocean-wash text-primary rounded-lg">
                <span className="material-symbols-outlined">group</span>
              </div>
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Total Leads</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.leads_count.toLocaleString()}</h3>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-warning-bg text-warning rounded-lg">
                <span className="material-symbols-outlined">edit_note</span>
              </div>
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Drafts Pending</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.drafts_pending}</h3>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-ocean-wash text-ocean-light rounded-lg">
                <span className="material-symbols-outlined">send</span>
              </div>
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Emails Sent</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.sent.toLocaleString()}</h3>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-success-bg text-success rounded-lg">
                <span className="material-symbols-outlined">forum</span>
              </div>
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Open Rate</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.open_rate}%</h3>
          </div>
        </div>
      )}

      {/* Leads table */}
      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-grey-100 bg-grey-50">
          <h3 className="text-[14px] font-semibold text-primary">Leads</h3>
        </div>
        {leads.length === 0 ? (
          <div className="px-6 py-12 text-center text-grey-400 text-[14px]">No leads for this campaign yet.</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-grey-50 border-b border-grey-100">
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Name</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Company</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Role</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Email</th>
                <th className="px-4 py-3 text-[14px] font-semibold text-grey-700 text-center">Verified</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {leads.map((lead, i) => {
                const badge = statusMap[lead.status] ?? statusMap.new!;
                const avatarClass = AVATAR_COLORS[i % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
                return (
                  <tr key={lead.id} className="hover:bg-ocean-wash transition-colors duration-150 cursor-pointer">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${avatarClass}`}>
                          {initials(lead)}
                        </div>
                        <span className="text-[14px] font-medium text-primary">
                          {[lead.first_name, lead.last_name].filter(Boolean).join(" ")}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[13px] text-grey-700">{lead.company_name}</td>
                    <td className="px-6 py-4 text-[13px] text-grey-500">{lead.role}</td>
                    <td className="px-6 py-4 text-[13px] font-mono text-ocean-light">{lead.email}</td>
                    <td className="px-4 py-4 text-center">
                      {lead.is_verified ? (
                        <span className="material-symbols-outlined text-success text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                          verified
                        </span>
                      ) : (
                        <span className="material-symbols-outlined text-grey-300 text-[18px]">verified</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[13px] font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="px-6 py-4 bg-grey-50 flex items-center justify-between border-t border-grey-100">
          <span className="text-[13px] text-grey-500">Showing {leads.length} lead{leads.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}
