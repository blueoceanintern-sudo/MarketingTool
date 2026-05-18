import { getLeads } from "@/lib/api";
import type { Lead, LeadStatus } from "@/lib/api";

const MOCK_LEADS: Lead[] = [
  { id: "L-001", first_name: "Sarah", last_name: "Kinsley", email: "s.kinsley@cloudscale.ai", role: "VP Marketing", is_verified: true, status: "contacted", company_name: "CloudScale AI", campaign_id: "CAM-9241", campaign_name: "Q3 APAC SaaS Prospecting", created_at: "2026-05-01T00:00:00Z" },
  { id: "L-002", first_name: "Marcus", last_name: "Rivera", email: "m.rivera@datavibe.com", role: "CTO", is_verified: true, status: "replied", company_name: "DataVibe Systems", campaign_id: "CAM-9241", campaign_name: "Q3 APAC SaaS Prospecting", created_at: "2026-05-02T00:00:00Z" },
  { id: "L-003", first_name: "Jenna", last_name: "Lane", email: "j.lane@orbit.io", role: "Sales Director", is_verified: false, status: "new", company_name: "Orbit Logistics", campaign_id: "CAM-9245", campaign_name: "US Enterprise FinTech Q4", created_at: "2026-05-03T00:00:00Z" },
  { id: "L-004", first_name: "Elena", last_name: "Rodriguez", email: "elena@inboundflow.co", role: "Head of Growth", is_verified: true, status: "converted", company_name: "Inbound Flow", campaign_id: "CAM-9241", campaign_name: "Q3 APAC SaaS Prospecting", created_at: "2026-05-04T00:00:00Z" },
  { id: "L-005", first_name: "Thomas", last_name: "Hales", email: "t.hales@nexuscore.net", role: "Product Manager", is_verified: true, status: "suppressed", company_name: "Nexus Core", campaign_id: "CAM-9248", campaign_name: "Healthcare Outreach - UK/EU", created_at: "2026-05-05T00:00:00Z" },
  { id: "L-006", first_name: "Priya", last_name: "Mehta", email: "p.mehta@fintechsg.io", role: "CFO", is_verified: true, status: "new", company_name: "FinTech SG", campaign_id: "CAM-9245", campaign_name: "US Enterprise FinTech Q4", created_at: "2026-05-06T00:00:00Z" },
  { id: "L-007", first_name: "Wei", last_name: "Zhang", email: "w.zhang@logisflow.com", role: "Operations Lead", is_verified: false, status: "contacted", company_name: "LogisFlow", campaign_id: "CAM-9255", campaign_name: "Direct Mail Sync - SG", created_at: "2026-05-07T00:00:00Z" },
];

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  new:        { label: "New",        className: "bg-secondary-fixed text-on-secondary-fixed-variant" },
  contacted:  { label: "Contacted",  className: "bg-ocean-wash text-primary" },
  replied:    { label: "Replied",    className: "bg-warning-bg text-warning" },
  converted:  { label: "Converted",  className: "bg-success-bg text-success" },
  suppressed: { label: "Suppressed", className: "bg-neutral-bg text-neutral" },
};

export default async function LeadsPage() {
  const apiLeads = await getLeads();
  const leads = apiLeads.length ? apiLeads : MOCK_LEADS;

  const totalVerified = leads.filter((l) => l.is_verified).length;
  const totalConverted = leads.filter((l) => l.status === "converted").length;

  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <span className="text-[13px] text-grey-500">Marketing</span>
            <span className="material-symbols-outlined text-[14px] text-grey-300">chevron_right</span>
            <span className="text-[13px] font-medium text-primary">All Leads</span>
          </nav>
          <h1 className="text-[20px] font-bold text-primary">All Leads</h1>
          <p className="text-[13px] text-grey-500 mt-1">
            Global leads across all campaigns — filter by status, campaign, or verification.
          </p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border border-grey-100 rounded-lg text-[14px] font-semibold text-primary hover:bg-grey-50 transition-colors">
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            Import CSV
          </button>
          <button className="flex items-center gap-2 px-4 py-2 border border-grey-100 rounded-lg text-[14px] font-semibold text-primary hover:bg-grey-50 transition-colors">
            <span className="material-symbols-outlined text-[18px]">file_download</span>
            Export
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Total Leads</p>
          <h3 className="text-[28px] font-bold text-primary font-mono mt-2">{leads.length.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Verified</p>
          <div className="flex items-baseline gap-2 mt-2">
            <h3 className="text-[28px] font-bold text-primary font-mono">{totalVerified}</h3>
            <span className="text-[13px] text-success">
              {leads.length ? Math.round((totalVerified / leads.length) * 100) : 0}%
            </span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Converted</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{totalConverted}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <p className="text-[13px] font-medium text-grey-500">Suppressed</p>
          <h3 className="text-[28px] font-bold text-grey-400 font-mono mt-2">
            {leads.filter((l) => l.status === "suppressed").length}
          </h3>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-grey-100 flex justify-between items-center bg-grey-50">
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-grey-100 rounded text-[13px] font-medium text-primary">
              <span className="material-symbols-outlined text-[18px] text-grey-500">filter_alt</span>
              All Statuses
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-grey-100 rounded text-[13px] font-medium text-primary">
              <span className="material-symbols-outlined text-[18px] text-grey-500">campaign</span>
              All Campaigns
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-grey-100 rounded text-[13px] font-medium text-primary">
              <span className="material-symbols-outlined text-[18px] text-grey-500">verified</span>
              Verified Only
            </button>
          </div>
          <p className="text-[13px] text-grey-500">Showing {leads.length} leads</p>
        </div>

        <table className="w-full border-collapse">
          <thead className="bg-grey-50 border-b border-grey-100">
            <tr className="text-left">
              <th className="px-6 py-4 text-[14px] font-semibold text-primary">Name</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Company</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Role</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Email</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary text-center">Verified</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Campaign</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Status</th>
              <th className="px-4 py-4 text-[14px] font-semibold text-primary">Added</th>
              <th className="px-6 py-4 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-grey-100">
            {leads.map((lead) => {
              const badge = statusConfig[lead.status];
              const initials = `${lead.first_name[0]}${lead.last_name[0]}`;
              return (
                <tr key={lead.id} className="hover:bg-ocean-wash transition-colors duration-150">
                  <td className="px-6 py-[11px]">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary-fixed text-on-primary-fixed flex items-center justify-center font-bold text-xs shrink-0">
                        {initials}
                      </div>
                      <span className="text-[14px] font-medium text-primary">
                        {lead.first_name} {lead.last_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-[11px] text-[13px] text-grey-700">{lead.company_name}</td>
                  <td className="px-4 py-[11px] text-[13px] text-grey-500">{lead.role}</td>
                  <td className="px-4 py-[11px] text-[13px] font-mono text-ocean-light">{lead.email}</td>
                  <td className="px-4 py-[11px] text-center">
                    {lead.is_verified ? (
                      <span className="material-symbols-outlined text-success text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        verified
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-grey-300 text-[20px]">
                        verified
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-[11px]">
                    <span className="text-[12px] text-grey-500 truncate block max-w-[160px]">
                      {lead.campaign_name ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-[11px]">
                    <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${badge.className}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-[11px] text-[13px] text-grey-400">
                    {new Date(lead.created_at).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-6 py-[11px] text-right">
                    <button className="material-symbols-outlined text-grey-400 hover:text-primary cursor-pointer">
                      more_vert
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="px-5 py-4 bg-grey-50 border-t border-grey-100 flex justify-between items-center">
          <span className="text-[13px] text-grey-500">Showing {leads.length} leads</span>
          <div className="flex items-center gap-2">
            <button className="p-1 border border-grey-100 rounded bg-white text-grey-300 cursor-not-allowed" disabled>
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <button className="w-8 h-8 rounded bg-primary text-white text-[13px] font-medium">1</button>
            <button className="p-1 border border-grey-100 rounded bg-white text-grey-500 hover:bg-grey-50">
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
