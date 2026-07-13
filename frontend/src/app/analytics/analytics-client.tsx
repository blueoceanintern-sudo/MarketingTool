"use client";

import { useQuery } from "@tanstack/react-query";
import { getAnalyticsOverview, getDailySends, downloadAnalyticsExport } from "@/lib/api";

export default function AnalyticsClient() {
  const { data: overview } = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => getAnalyticsOverview(),
  });

  const { data: dailySends = [] } = useQuery({
    queryKey: ["analytics", "daily-sends", 30],
    queryFn: () => getDailySends(30),
  });

  const kpiTiles = [
    {
      label: "Total Leads Contacted",
      value: overview ? overview.total_leads_contacted.toLocaleString() : "—",
      icon: "person_add",
      trend: overview ? `${overview.total_sent.toLocaleString()} emails sent` : "—",
      trendClass: "text-grey-500",
      trendIcon: "mail",
      danger: false,
    },
    {
      label: "Open Rate",
      value: overview ? `${overview.open_rate}%` : "—",
      icon: "drafts",
      trend: overview ? `${overview.total_opened.toLocaleString()} opens` : "—",
      trendClass: overview && overview.open_rate >= 30 ? "text-success" : "text-warning",
      trendIcon: overview && overview.open_rate >= 30 ? "trending_up" : "trending_flat",
      danger: false,
    },
    {
      label: "Reply Rate",
      value: overview ? `${overview.reply_rate}%` : "—",
      icon: "reply_all",
      trend: overview ? `${overview.total_replied.toLocaleString()} replies` : "—",
      trendClass: "text-grey-500",
      trendIcon: "trending_flat",
      danger: false,
    },
    {
      label: "Demos Booked",
      value: overview ? overview.total_demos.toLocaleString() : "—",
      icon: "event_available",
      trend: overview ? `${overview.total_demos} total` : "—",
      trendClass: "text-success",
      trendIcon: "trending_up",
      danger: false,
    },
    {
      label: "Pending Review",
      value: overview ? overview.pending_review.toLocaleString() : "—",
      icon: overview && overview.pending_review > 0 ? "warning" : "check_circle",
      trend: overview && overview.pending_review > 0 ? "Drafts awaiting approval" : "Queue clear",
      trendClass: overview && overview.pending_review > 0 ? "text-danger" : "text-success",
      trendIcon: overview && overview.pending_review > 0 ? "priority_high" : "check",
      danger: overview != null && overview.pending_review > 0,
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-[24px] font-bold text-primary mb-1">Analytics Dashboard</h1>
          <p className="text-[14px] text-grey-500">
            Real-time performance across all automated outreach channels.
          </p>
        </div>
        <button
          onClick={downloadAnalyticsExport}
          className="flex items-center gap-2 px-4 py-2 border border-primary text-primary text-[14px] font-semibold rounded-lg hover:bg-ocean-wash active:opacity-80 transition-all duration-150"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          Export CSV
        </button>
      </div>

      {/* 5-column KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
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
              <span className={`material-symbols-outlined text-[20px] ${tile.danger ? "text-danger" : "text-grey-300"}`}>
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

      {/* Bar chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 mb-8">
        <div className="lg:col-span-8 bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-[16px] font-semibold text-primary">Emails Sent Over Time</h3>
            <div className="flex gap-2">
              <span className="px-2 py-1 bg-primary text-white text-[11px] rounded">30 Days</span>
            </div>
          </div>
          {dailySends.length === 0 ? (
            <div className="h-[280px] flex flex-col items-center justify-center gap-2 text-grey-300">
              <span className="material-symbols-outlined text-[40px]">bar_chart</span>
              <p className="text-[13px]">No data yet</p>
            </div>
          ) : (() => {
            const maxCount = Math.max(...dailySends.map((d) => d.count), 1);
            const peakIndex = dailySends.reduce((best, d, i) => (d.count > dailySends[best].count ? i : best), 0);
            const xLabels = [0, 7, 14, 21, 29].map((i) => {
              const entry = dailySends[Math.min(i, dailySends.length - 1)];
              return entry ? entry.date.slice(5) : "";
            });
            return (
              <>
                <div className="h-[280px] w-full flex items-end justify-between px-2 gap-1 relative">
                  <div className="absolute inset-0 flex flex-col justify-between py-2 pointer-events-none">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="border-t border-grey-50 w-full" />
                    ))}
                  </div>
                  {dailySends.map((d, i) => {
                    const h = Math.round((d.count / maxCount) * 85);
                    const isActive = i === peakIndex;
                    return (
                      <div key={d.date} className="w-full relative flex-1" style={{ height: `${h}%` }}>
                        {isActive && (
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                            {d.count} sent
                          </div>
                        )}
                        <div className={`w-full h-full rounded-t-sm ${isActive ? "bg-primary" : "bg-secondary-container"}`} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-4 px-2 text-[11px] text-grey-500">
                  {xLabels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* Reply sentiment */}
        <div className="lg:col-span-4 bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] flex flex-col">
          <h3 className="text-[16px] font-semibold text-primary mb-6">Reply Breakdown</h3>
          {overview ? (
            <div className="flex-1 flex flex-col justify-center gap-4">
              {[
                { label: "Total Sent", value: overview.total_sent, className: "bg-primary" },
                { label: "Opened", value: overview.total_opened, className: "bg-success" },
                { label: "Replied", value: overview.total_replied, className: "bg-warning" },
                { label: "Demos Booked", value: overview.total_demos, className: "bg-ocean-light" },
              ].map(({ label, value, className }) => (
                <div key={label}>
                  <div className="flex justify-between text-[13px] mb-1">
                    <span className="text-grey-700">{label}</span>
                    <span className="font-mono font-medium text-primary">{value.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-grey-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${className}`}
                      style={{ width: `${overview.total_sent > 0 ? Math.min(100, (value / overview.total_sent) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-grey-400 text-[13px]">No data yet.</p>
          )}
        </div>
      </div>

      {/* Suppressions */}
      {overview && overview.total_suppressions > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border-l-4 border-danger mb-8">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-danger text-[24px]">block</span>
            <div>
              <p className="text-[14px] font-semibold text-primary">
                {overview.total_suppressions} suppressed email{overview.total_suppressions !== 1 ? "s" : ""}
              </p>
              <p className="text-[13px] text-grey-500">Unsubscribes, spam complaints, and manual suppressions.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
