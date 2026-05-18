type TemplateStatus = "active" | "paused" | "draft";

interface KpiTile {
  label: string;
  value: string;
  icon: string;
  trend: string;
  trendClass: string;
  trendIcon: string;
  danger?: boolean;
}

interface Template {
  name: string;
  modified: string;
  status: TemplateStatus;
  sent: string;
  opens: string;
  replies: string;
}

const kpiTiles: KpiTile[] = [
  {
    label: "Total Leads Contacted",
    value: "12,482",
    icon: "person_add",
    trend: "12.4% vs last month",
    trendClass: "text-success",
    trendIcon: "trending_up",
  },
  {
    label: "Open Rate",
    value: "54.2%",
    icon: "drafts",
    trend: "3.1% vs last month",
    trendClass: "text-success",
    trendIcon: "trending_up",
  },
  {
    label: "Reply Rate",
    value: "8.7%",
    icon: "reply_all",
    trend: "0.2% vs last month",
    trendClass: "text-warning",
    trendIcon: "trending_flat",
  },
  {
    label: "Demos Booked",
    value: "142",
    icon: "event_available",
    trend: "18 new this week",
    trendClass: "text-success",
    trendIcon: "trending_up",
  },
  {
    label: "Spam Complaint Rate",
    value: "0.82%",
    icon: "warning",
    trend: "+0.14% above threshold",
    trendClass: "text-danger",
    trendIcon: "trending_up",
    danger: true,
  },
];

/* bar heights as % — index 4 is the highlighted active bar */
const barHeights = [40, 55, 48, 65, 85, 70, 60, 52, 45, 35, 58, 68];

const sentimentLegend = [
  { label: "Interested / Positive", pct: "86%", dot: "bg-success" },
  { label: "Follow-up Later",       pct: "9%",  dot: "bg-warning" },
  { label: "Not Interested",        pct: "5%",  dot: "bg-danger" },
];

const templates: Template[] = [
  {
    name: "Product Intro V2 - SaaS Founders",
    modified: "Modified 2 days ago",
    status: "active",
    sent: "4,281",
    opens: "62.4%",
    replies: "12.1%",
  },
  {
    name: "Feature Update - Q3 Roadmap",
    modified: "Modified 5 days ago",
    status: "active",
    sent: "2,105",
    opens: "48.2%",
    replies: "7.4%",
  },
  {
    name: "Webinar Invitation - Oct 15",
    modified: "Modified 1 day ago",
    status: "paused",
    sent: "1,540",
    opens: "31.8%",
    replies: "2.1%",
  },
  {
    name: "Re-engagement Campaign - Cold Leads",
    modified: "Modified 1 week ago",
    status: "draft",
    sent: "0",
    opens: "0.0%",
    replies: "0.0%",
  },
];

const statusBadge: Record<TemplateStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-success-bg text-success" },
  paused: { label: "Paused", className: "bg-warning-bg text-warning" },
  draft:  { label: "Draft",  className: "bg-neutral-bg text-neutral" },
};

export default function AnalyticsPage() {
  return (
    <div className="p-10 max-w-[1600px] mx-auto">

      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-[24px] font-bold text-primary mb-1">Analytics Dashboard</h1>
          <p className="text-[14px] text-grey-500">
            Real-time performance across all automated outreach channels.
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-primary text-primary text-[14px] font-semibold rounded-lg hover:bg-ocean-wash active:opacity-80 transition-all duration-150">
          <span className="material-symbols-outlined text-[18px]">download</span>
          Export CSV
        </button>
      </div>

      {/* 5-column KPI tiles */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {kpiTiles.map((tile) => (
          <div
            key={tile.label}
            className={[
              "bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]",
              tile.danger ? "border-l-4 border-danger" : "",
            ].join(" ")}
          >
            <div className="flex justify-between items-start mb-2">
              <p className="text-[13px] font-medium text-grey-500 leading-snug">{tile.label}</p>
              <span
                className={`material-symbols-outlined text-[20px] ${tile.danger ? "text-danger" : "text-grey-300"}`}
              >
                {tile.icon}
              </span>
            </div>
            <p className={`text-[24px] font-bold ${tile.danger ? "text-danger" : "text-primary"} font-mono`}>
              {tile.value}
            </p>
            <div className={`flex items-center gap-1 mt-2 ${tile.trendClass}`}>
              <span className="material-symbols-outlined text-[14px]">{tile.trendIcon}</span>
              <span className="text-[11px]">{tile.trend}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-12 gap-8 mb-8">

        {/* Bar chart — col-span-8 */}
        <div className="col-span-8 bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-[16px] font-semibold text-primary">Emails Sent Over Time</h3>
            <div className="flex gap-2">
              <span className="px-2 py-1 bg-grey-50 text-grey-700 text-[11px] rounded border border-grey-100">
                7 Days
              </span>
              <span className="px-2 py-1 bg-primary text-white text-[11px] rounded">
                30 Days
              </span>
            </div>
          </div>

          {/* Bar chart */}
          <div className="h-[280px] w-full flex items-end justify-between px-2 gap-1 relative">
            {/* Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between py-2 pointer-events-none">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="border-t border-grey-50 w-full" />
              ))}
            </div>
            {/* Bars */}
            {barHeights.map((h, i) => {
              const isActive = i === 4;
              return (
                <div
                  key={i}
                  className="w-full relative flex-1"
                  style={{ height: `${h}%` }}
                >
                  {isActive && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                      2.4k
                    </div>
                  )}
                  <div
                    className={`w-full h-full rounded-t-sm ${isActive ? "bg-primary" : "bg-secondary-container"}`}
                  />
                </div>
              );
            })}
          </div>

          {/* X-axis labels */}
          <div className="flex justify-between mt-4 px-2 text-[11px] text-grey-500">
            <span>Oct 01</span>
            <span>Oct 07</span>
            <span>Oct 14</span>
            <span>Oct 21</span>
            <span>Oct 30</span>
          </div>
        </div>

        {/* Donut chart — col-span-4 */}
        <div className="col-span-4 bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] flex flex-col">
          <h3 className="text-[16px] font-semibold text-primary mb-6">Reply Sentiment</h3>
          <div className="flex-1 flex flex-col items-center justify-center">
            {/* CSS border donut approximation */}
            <div
              className="w-48 h-48 rounded-full flex items-center justify-center -rotate-45"
              style={{
                border: "18px solid",
                borderTopColor: "#1A9E6B",
                borderRightColor: "#D4860A",
                borderBottomColor: "#C7322A",
                borderLeftColor: "#ECEEF2",
              }}
            >
              <div className="rotate-45 flex flex-col items-center">
                <span className="text-[24px] font-bold text-primary font-mono">86%</span>
                <span className="text-[11px] text-grey-500">Positive</span>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-8 w-full space-y-3">
              {sentimentLegend.map(({ label, pct, dot }) => (
                <div key={label} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                    <span className="text-[13px] text-grey-700">{label}</span>
                  </div>
                  <span className="text-[13px] font-medium text-primary">{pct}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Template performance table */}
      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] overflow-hidden">
        <div className="px-6 py-5 border-b border-grey-100 flex justify-between items-center">
          <h3 className="text-[16px] font-semibold text-primary">Template Performance</h3>
          <button className="text-[13px] font-medium text-ocean-light hover:underline">
            View All Templates
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-grey-50 text-grey-700 text-[14px] font-semibold">
            <tr>
              <th className="px-6 py-4">Template Name</th>
              <th className="px-4 py-4 text-center">Status</th>
              <th className="px-4 py-4 text-right">Sent</th>
              <th className="px-4 py-4 text-right">Opens</th>
              <th className="px-4 py-4 text-right">Replies</th>
              <th className="px-6 py-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="text-[13px] text-grey-700 divide-y divide-grey-100">
            {templates.map((t) => {
              const badge = statusBadge[t.status];
              return (
                <tr key={t.name} className="hover:bg-ocean-wash transition-colors duration-150">
                  <td className="px-6 py-[14px]">
                    <span className="block text-[13px] font-medium text-primary">{t.name}</span>
                    <span className="text-[11px] text-grey-500">{t.modified}</span>
                  </td>
                  <td className="px-4 py-[14px] text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-[14px] text-right font-mono text-[13px]">{t.sent}</td>
                  <td className="px-4 py-[14px] text-right font-mono text-[13px]">{t.opens}</td>
                  <td className="px-4 py-[14px] text-right font-mono text-[13px]">{t.replies}</td>
                  <td className="px-6 py-[14px] text-center">
                    <div className="flex justify-center gap-2 text-grey-500">
                      <button className="p-1 hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button className="p-1 hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[18px]">more_vert</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="px-6 py-4 bg-grey-50 border-t border-grey-100 flex items-center justify-between">
          <span className="text-[11px] text-grey-500">Showing 4 of 24 templates</span>
          <div className="flex gap-2">
            <button
              className="p-1 border border-grey-100 rounded bg-white text-grey-500 opacity-50 cursor-not-allowed"
              disabled
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <button className="p-1 border border-grey-100 rounded bg-white text-grey-500 hover:text-primary transition-colors">
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
