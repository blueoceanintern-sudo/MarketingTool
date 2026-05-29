"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/api";
import LeadActions from "./lead-actions";

const AVATAR_COLORS = [
  "bg-primary-fixed text-on-primary-fixed",
  "bg-secondary-fixed text-on-secondary-fixed-variant",
  "bg-[#ffdcc1] text-[#2e1500]",
  "bg-ocean-wash text-primary",
  "bg-primary-container text-white",
];

const statusMap: Record<string, { label: string; className: string }> = {
  new:        { label: "New",        className: "bg-neutral-bg text-neutral" },
  contacted:  { label: "Contacted",  className: "bg-ocean-wash text-primary" },
  replied:    { label: "Replied",    className: "bg-warning-bg text-warning" },
  converted:  { label: "Converted",  className: "bg-success-bg text-success" },
  suppressed: { label: "Suppressed", className: "bg-danger-bg text-danger" },
};

function initials(lead: Lead) {
  return `${lead.first_name?.[0] ?? ""}${lead.last_name?.[0] ?? ""}`.toUpperCase() || "?";
}

interface Props {
  initialLeads: Lead[];
  campaignId: string;
}

export default function CampaignLeadsClient({ initialLeads, campaignId }: Props) {
  // IDs removed optimistically — survive any router.refresh() bringing stale server data
  const removedIds = useRef<Set<string>>(new Set());
  const [leads, setLeads] = useState(initialLeads);

  // Sync whenever the server sends fresh initialLeads (scrape polling, etc.),
  // but always exclude anything the user has already removed locally.
  useEffect(() => {
    setLeads(initialLeads.filter((l) => !removedIds.current.has(l.id)));
  }, [initialLeads]);

  function handleRemoved(leadId: string) {
    removedIds.current.add(leadId);
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
  }

  return (
    <>
      {/* Total Leads KPI tile — dynamic, lives here so it updates on removes and scrape polling */}
      <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 mb-8">
        <div className="flex justify-between items-start mb-4">
          <div className="p-2 bg-ocean-wash text-primary rounded-lg">
            <span className="material-symbols-outlined">group</span>
          </div>
        </div>
        <p className="text-[13px] text-grey-500 mb-1">Total Leads</p>
        <h3 className="text-[28px] font-bold text-primary font-mono">{leads.length.toLocaleString()}</h3>
      </div>

      {/* Leads table card */}
      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden">
      {/* Section header */}
      <div className="px-6 py-4 border-b border-grey-100 bg-grey-50">
        <h3 className="text-[14px] font-semibold text-primary">Leads</h3>
      </div>

      {leads.length === 0 ? (
        <div className="px-6 py-12 text-center text-grey-400 text-[14px]">No leads for this campaign yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-grey-50 border-b border-grey-100">
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Name</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Company</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Role</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Email</th>
                <th className="px-4 py-3 text-[14px] font-semibold text-grey-700 text-center">Verified</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Status</th>
                <th className="px-2 py-3 text-[14px] font-semibold text-grey-700 text-right pr-6"></th>
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
                    <td className="px-2 py-4 text-right pr-6">
                      <LeadActions
                        leadId={lead.id}
                        leadName={[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email}
                        currentCampaignId={campaignId}
                        onRemoved={handleRemoved}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </>
  );
}
