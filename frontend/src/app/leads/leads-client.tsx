"use client";

import { useMemo, useState } from "react";
import type { Lead, LeadStatus } from "@/lib/api";

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-secondary-fixed text-on-secondary-fixed-variant" },
  contacted: { label: "Contacted", className: "bg-ocean-wash text-primary" },
  replied: { label: "Replied", className: "bg-warning-bg text-warning" },
  converted: { label: "Converted", className: "bg-success-bg text-success" },
  suppressed: { label: "Suppressed", className: "bg-neutral-bg text-neutral" },
};

interface Props {
  initialLeads: Lead[];
}

export default function LeadsClient({ initialLeads }: Props) {
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const campaigns = useMemo(() => {
    const names = new Set(initialLeads.map((l) => l.campaign_name).filter(Boolean) as string[]);
    return Array.from(names).sort();
  }, [initialLeads]);

  const filtered = useMemo(() => {
    return initialLeads.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (campaignFilter !== "all" && lead.campaign_name !== campaignFilter) return false;
      if (verifiedOnly && !lead.is_verified) return false;
      return true;
    });
  }, [initialLeads, statusFilter, campaignFilter, verifiedOnly]);

  const totalVerified = filtered.filter((l) => l.is_verified).length;
  const totalConverted = filtered.filter((l) => l.status === "converted").length;

  if (initialLeads.length === 0) {
    return (
      <div className="p-10 max-w-[1600px] mx-auto">
        <h1 className="text-[20px] font-bold text-primary">All Leads</h1>
        <p className="mt-8 text-center text-grey-400 text-[14px]">
          No leads yet. Run a campaign scrape or import a CSV to add leads.
        </p>
      </div>
    );
  }

  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      <div className="mb-8">
        <h1 className="text-[20px] font-bold text-primary">All Leads</h1>
        <p className="text-[13px] text-grey-500 mt-1">{initialLeads.length} leads total</p>
      </div>

      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Showing</p>
          <h3 className="text-[28px] font-bold font-mono mt-2">{filtered.length}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Verified</p>
          <h3 className="text-[28px] font-bold font-mono mt-2">{totalVerified}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Converted</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{totalConverted}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Suppressed</p>
          <h3 className="text-[28px] font-bold text-grey-400 font-mono mt-2">
            {filtered.filter((l) => l.status === "suppressed").length}
          </h3>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-grey-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-grey-100 bg-grey-50 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "all")}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="all">All Statuses</option>
              {(Object.keys(statusConfig) as LeadStatus[]).map((s) => (
                <option key={s} value={s}>
                  {statusConfig[s].label}
                </option>
              ))}
            </select>
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="all">All Campaigns</option>
              {campaigns.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setVerifiedOnly((v) => !v)}
              className={[
                "px-3 py-1.5 border rounded text-[13px] font-medium",
                verifiedOnly ? "bg-primary text-white border-primary" : "bg-white border-grey-100",
              ].join(" ")}
            >
              Verified Only
            </button>
          </div>
          <p className="text-[13px] text-grey-500">{filtered.length} leads</p>
        </div>

        {filtered.length === 0 ? (
          <p className="px-6 py-12 text-center text-grey-400">No leads match these filters.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="bg-grey-50 border-b border-grey-100">
              <tr className="text-left">
                <th className="px-6 py-4 text-[14px] font-semibold">Name</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Company</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Email</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Campaign</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {filtered.map((lead) => {
                const badge = statusConfig[lead.status];
                return (
                  <tr key={lead.id} className="hover:bg-ocean-wash">
                    <td className="px-6 py-3 text-[14px] font-medium">
                      {lead.first_name} {lead.last_name}
                    </td>
                    <td className="px-4 py-3 text-[13px]">{lead.company_name}</td>
                    <td className="px-4 py-3 text-[13px] font-mono">{lead.email}</td>
                    <td className="px-4 py-3 text-[12px] text-grey-500">{lead.campaign_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${badge.className}`}>
                        {badge.label}
                      </span>
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
