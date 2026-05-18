import Link from "next/link";

type DraftStatus = "sent" | "reviewing" | "pending" | "rejected" | "personalizing";

interface Lead {
  initials: string;
  avatarClass: string;
  name: string;
  company: string;
  role: string;
  email: string;
  verified: boolean;
  draftStatus: DraftStatus;
  lastActivity: string;
}

const leads: Lead[] = [
  {
    initials: "SK",
    avatarClass: "bg-primary-fixed text-on-primary-fixed",
    name: "Sarah Kinsley",
    company: "CloudScale AI",
    role: "VP Marketing",
    email: "s.kinsley@cloudscale.ai",
    verified: true,
    draftStatus: "sent",
    lastActivity: "2h ago",
  },
  {
    initials: "MR",
    avatarClass: "bg-secondary-fixed text-on-secondary-fixed-variant",
    name: "Marcus Rivera",
    company: "DataVibe Systems",
    role: "CTO",
    email: "m.rivera@datavibe.com",
    verified: true,
    draftStatus: "reviewing",
    lastActivity: "5h ago",
  },
  {
    initials: "JL",
    avatarClass: "bg-[#ffdcc1] text-[#2e1500]",
    name: "Jenna Lane",
    company: "Orbit Logistics",
    role: "Sales Director",
    email: "j.lane@orbit.io",
    verified: false,
    draftStatus: "pending",
    lastActivity: "Yesterday",
  },
  {
    initials: "ER",
    avatarClass: "bg-ocean-wash text-primary",
    name: "Elena Rodriguez",
    company: "Inbound Flow",
    role: "Head of Growth",
    email: "elena@inboundflow.co",
    verified: true,
    draftStatus: "rejected",
    lastActivity: "2d ago",
  },
  {
    initials: "TH",
    avatarClass: "bg-primary-container text-white",
    name: "Thomas Hales",
    company: "Nexus Core",
    role: "Product Manager",
    email: "t.hales@nexuscore.net",
    verified: true,
    draftStatus: "personalizing",
    lastActivity: "3d ago",
  },
];

const draftStatusConfig: Record<DraftStatus, { label: string; className: string }> = {
  sent:          { label: "Sent",          className: "bg-success-bg text-success" },
  reviewing:     { label: "Reviewing",     className: "bg-warning-bg text-warning" },
  pending:       { label: "Pending",       className: "bg-neutral-bg text-neutral" },
  rejected:      { label: "Rejected",      className: "bg-danger-bg text-danger" },
  personalizing: { label: "Personalizing", className: "bg-ocean-wash text-primary" },
};

const activityLog = [
  {
    color: "bg-success",
    message: (
      <>
        Automated batch of 50 emails sent for{" "}
        <span className="font-bold">CloudScale AI</span>
      </>
    ),
    time: "Oct 24, 10:30 AM",
  },
  {
    color: "bg-warning",
    message: (
      <>
        Campaign paused due to low verification rate on{" "}
        <span className="font-bold">Lead Source B</span>
      </>
    ),
    time: "Oct 23, 04:15 PM",
  },
];

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <Link href="/campaigns" className="text-[13px] text-grey-500 hover:text-primary transition-colors">
              Campaigns
            </Link>
            <span className="material-symbols-outlined text-[16px] text-grey-300">
              chevron_right
            </span>
            <span className="text-[13px] font-medium text-primary">Enterprise SaaS Outreach Q3</span>
          </nav>
          <h2 className="text-[20px] font-bold text-primary">Enterprise SaaS Outreach Q3</h2>
          <p className="text-[11px] text-grey-500 mt-1">ID: {id}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border border-grey-300 rounded-lg text-[14px] font-semibold text-grey-700 hover:bg-grey-50 transition-colors duration-150">
            <span className="material-symbols-outlined text-[20px]">file_download</span>
            Export CSV
          </button>
          <button className="flex items-center gap-2 px-4 py-2 border border-danger rounded-lg text-[14px] font-semibold text-danger hover:bg-danger-bg transition-colors duration-150">
            <span className="material-symbols-outlined text-[20px]">pause_circle</span>
            Pause Campaign
          </button>
        </div>
      </div>

      {/* Bento KPI grid */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-ocean-wash text-primary rounded-lg">
              <span className="material-symbols-outlined">group</span>
            </div>
            <span className="text-[13px] font-medium text-success">+12% vs last week</span>
          </div>
          <p className="text-[13px] text-grey-500 mb-1">Total Leads</p>
          <h3 className="text-[28px] font-bold text-primary font-mono">1,284</h3>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-warning-bg text-warning rounded-lg">
              <span className="material-symbols-outlined">edit_note</span>
            </div>
            <span className="text-[13px] text-grey-500">24 requiring review</span>
          </div>
          <p className="text-[13px] text-grey-500 mb-1">Drafts Pending</p>
          <h3 className="text-[28px] font-bold text-primary font-mono">86</h3>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-ocean-wash text-ocean-light rounded-lg">
              <span className="material-symbols-outlined">send</span>
            </div>
            <span className="text-[13px] text-grey-500">98% delivery rate</span>
          </div>
          <p className="text-[13px] text-grey-500 mb-1">Emails Sent</p>
          <h3 className="text-[28px] font-bold text-primary font-mono">4,521</h3>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-success-bg text-success rounded-lg">
              <span className="material-symbols-outlined">forum</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[13px] font-medium text-success">Above average</span>
            </div>
          </div>
          <p className="text-[13px] text-grey-500 mb-1">Reply Rate</p>
          <h3 className="text-[28px] font-bold text-primary font-mono">18.4%</h3>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-grey-100 mb-6 flex items-center justify-between">
        <div className="flex gap-8">
          <button className="pb-3 border-b-2 border-primary text-primary text-[14px] font-semibold px-1">
            Leads
          </button>
          <button className="pb-3 border-b-2 border-transparent text-grey-500 text-[14px] font-medium hover:text-primary transition-colors px-1">
            Drafts
          </button>
          <button className="pb-3 border-b-2 border-transparent text-grey-500 text-[14px] font-medium hover:text-primary transition-colors px-1">
            Scrape Jobs
          </button>
          <button className="pb-3 border-b-2 border-transparent text-grey-500 text-[14px] font-medium hover:text-primary transition-colors px-1">
            Performance
          </button>
        </div>
        <div className="flex gap-2 mb-2">
          <button className="p-1.5 text-grey-500 hover:bg-grey-100 rounded transition-colors">
            <span className="material-symbols-outlined text-[20px]">filter_list</span>
          </button>
          <button className="p-1.5 text-grey-500 hover:bg-grey-100 rounded transition-colors">
            <span className="material-symbols-outlined text-[20px]">sort</span>
          </button>
        </div>
      </div>

      {/* Leads table */}
      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-grey-50 border-b border-grey-100">
              <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Name</th>
              <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Company</th>
              <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Role</th>
              <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Email</th>
              <th className="px-4 py-3 text-[14px] font-semibold text-grey-700 text-center">
                Verified
              </th>
              <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Draft Status</th>
              <th className="px-6 py-3 text-[14px] font-semibold text-grey-700 text-right">
                Last Activity
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grey-100">
            {leads.map((lead) => {
              const badge = draftStatusConfig[lead.draftStatus];
              return (
                <tr
                  key={lead.email}
                  className="hover:bg-ocean-wash transition-colors duration-150 cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${lead.avatarClass}`}
                      >
                        {lead.initials}
                      </div>
                      <span className="text-[14px] font-medium text-primary">{lead.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[13px] text-grey-700">{lead.company}</td>
                  <td className="px-6 py-4 text-[13px] text-grey-500">{lead.role}</td>
                  <td className="px-6 py-4 text-[13px] font-mono text-ocean-light">
                    {lead.email}
                  </td>
                  <td className="px-4 py-4 text-center">
                    {lead.verified ? (
                      <span
                        className="material-symbols-outlined text-success text-[18px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        verified
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-grey-300 text-[18px]">
                        verified
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[13px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-grey-500">
                    {lead.lastActivity}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Table pagination */}
        <div className="px-6 py-4 bg-grey-50 flex items-center justify-between border-t border-grey-100">
          <span className="text-[13px] text-grey-500">Showing 1–10 of 1,284 leads</span>
          <div className="flex items-center gap-2">
            <button className="p-1 border border-grey-100 rounded bg-white text-grey-500 opacity-50 cursor-not-allowed">
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <button className="px-3 py-1 border border-primary bg-ocean-wash text-primary text-[13px] font-medium rounded">
              1
            </button>
            <button className="px-3 py-1 border border-grey-100 bg-white text-grey-700 text-[13px] font-medium rounded hover:bg-grey-50">
              2
            </button>
            <button className="px-3 py-1 border border-grey-100 bg-white text-grey-700 text-[13px] font-medium rounded hover:bg-grey-50">
              3
            </button>
            <button className="p-1 border border-grey-100 rounded bg-white text-grey-500 hover:bg-grey-50">
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Footer: activity log + confidence widget */}
      <div className="mt-10 grid grid-cols-3 gap-10">
        <div className="col-span-2">
          <h4 className="text-[16px] font-semibold text-primary mb-4">Campaign Activity Log</h4>
          <div className="space-y-4">
            {activityLog.map((entry, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-2.5 h-2.5 rounded-full ${entry.color} mt-0.5`} />
                  {i < activityLog.length - 1 && (
                    <div className="w-px flex-1 bg-grey-100 my-1" />
                  )}
                </div>
                <div>
                  <p className="text-[13px] text-primary">{entry.message}</p>
                  <p className="text-[11px] text-grey-500 mt-0.5">{entry.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Confidence widget */}
        <div className="bg-white p-6 rounded-lg border border-grey-100 shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
          <h4 className="text-[14px] font-semibold text-primary mb-4">Targeting Confidence</h4>
          <div className="mb-4">
            <div className="flex justify-between items-end mb-2">
              <span className="px-3 py-1 bg-success text-white rounded font-bold text-sm">
                High
              </span>
              <span className="text-[11px] text-grey-500 uppercase tracking-wide">
                Heuristic Signal
              </span>
            </div>
            <div className="w-full bg-grey-100 h-1.5 rounded-full overflow-hidden">
              <div className="bg-success h-full rounded-full" style={{ width: "88%" }} />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-grey-700">✓ Domain Authority</span>
              <span className="text-[13px] font-medium text-success">Excellent</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-grey-700">✓ Persona Match</span>
              <span className="text-[13px] font-medium text-success">Strong</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-grey-700">⚠ Verified Email Rate</span>
              <span className="text-[13px] font-medium text-warning">Moderate</span>
            </div>
          </div>
          <button className="w-full mt-6 py-2 border border-grey-100 rounded-lg text-[13px] font-medium text-grey-500 hover:bg-grey-50 transition-colors duration-150">
            View Detailed Heuristics
          </button>
        </div>
      </div>
    </div>
  );
}
