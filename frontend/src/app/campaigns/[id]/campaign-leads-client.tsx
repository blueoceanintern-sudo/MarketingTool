"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { Lead } from "@/lib/api";
import { campaignLeadsOptions } from "@/lib/queries";
import { useJobEvents } from "@/lib/job-events";
import LeadActions from "./lead-actions";
import Pagination from "@/components/pagination";
import { LeadEnrichmentDrawer, statusConfig } from "@/components/lead-enrichment-drawer";

const LEADS_PER_PAGE = 25;

const AVATAR_COLORS = [
  "bg-primary-fixed text-on-primary-fixed",
  "bg-secondary-fixed text-on-secondary-fixed-variant",
  "bg-[#ffdcc1] text-[#2e1500]",
  "bg-ocean-wash text-primary",
  "bg-primary-container text-white",
];


function initials(lead: Lead) {
  const parts = lead.name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
}

interface Props {
  campaignId: string;
  initialPage: number;
}

export default function CampaignLeadsClient({ campaignId, initialPage }: Props) {
  const [page, setPage] = useState(initialPage);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const { data, isFetching } = useQuery({
    ...campaignLeadsOptions(campaignId, page, LEADS_PER_PAGE),
    placeholderData: keepPreviousData,
  });

  const leads = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 0;

  const start = total === 0 ? 0 : (page - 1) * LEADS_PER_PAGE + 1;
  const end = Math.min(page * LEADS_PER_PAGE, total);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  // Listen for enrichment_complete SSE events scoped to this campaign.
  useJobEvents((event) => {
    if (event.kind === "enrichment_complete" && event.campaignId === campaignId) {
      showToast(
        event.count > 0
          ? `${event.count} lead${event.count !== 1 ? "s" : ""} enriched.`
          : "Enrichment complete — no leads updated.",
      );
    }
  });

  return (
    <>
      <div className={`bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden transition-opacity duration-150 ${isFetching ? "opacity-60" : ""}`}>
        <div className="px-6 py-4 border-b border-grey-100 bg-grey-50 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-primary">Leads</h3>
          <div className="flex items-center gap-3">
            {total > 0 && (
              <p className="text-[13px] text-grey-500">
                {`${start}–${end} of ${total.toLocaleString()}`}
              </p>
            )}
          </div>
        </div>

        {leads.length === 0 && !isFetching ? (
          <div className="px-6 py-12 text-center text-grey-400 text-[14px]">No leads for this campaign yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-grey-50 border-b border-grey-100">
                  <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Name</th>
                  <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Company</th>
                  <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Email</th>
                  <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Role</th>
                  <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Status</th>
                  <th className="px-2 py-3 text-[14px] font-semibold text-grey-700 text-right pr-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-100">
                {leads.map((lead, i) => {
                  const badge = statusConfig[lead.status] ?? statusConfig.new;
                  const avatarClass = AVATAR_COLORS[i % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-ocean-wash transition-colors duration-150 cursor-pointer"
                      onClick={() => setSelectedLead(lead)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${avatarClass}`}>
                            {initials(lead)}
                          </div>
                          <span className="text-[14px] font-medium text-primary">
                            {lead.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[13px] text-grey-700">{lead.company_name}</td>
                      <td className="px-6 py-4 text-[13px] font-mono text-ocean-light">{lead.email}</td>
                      <td className="px-6 py-4 text-[13px] text-grey-500">{lead.role}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[13px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-2 py-4 text-right pr-6" onClick={(e) => e.stopPropagation()}>
                        <LeadActions
                          leadId={lead.id}
                          leadName={lead.name || lead.email}
                          currentCampaignId={campaignId}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-grey-100 flex items-center justify-between">
            <p className="text-[13px] text-grey-500">Page {page} of {totalPages}</p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadEnrichmentDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}

      {/* Toast notification — appears at bottom of page when enrichment completes */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-primary text-white px-4 py-3 rounded-lg shadow-lg text-[14px] max-w-xs animate-fade-in">
          <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
          {toast}
        </div>
      )}
    </>
  );
}
