"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  scrapeLeads,
  triggerEnrichment,
  type EmailStatus,
  type EnrichmentRouting,
  type Lead,
  type LeadStatus,
} from "@/lib/api";
import { toast } from "sonner";
import { leadsOptions, leadsSummaryOptions, campaignsOptions, sourceCoverageOptions, keys, type LeadsParams } from "@/lib/queries";
import Pagination from "@/components/pagination";
import { LeadEnrichmentDrawer, statusConfig, emailStatusConfig, routingConfig } from "@/components/lead-enrichment-drawer";
import { useJobEvents } from "@/lib/job-events";


interface Props {
  page: number;
  statusFilter: string;
  emailStatusFilter: string;
  routingFilter: string;
  campaignIdFilter: string;
  searchFilter: string;
}

export default function LeadsClient({
  page,
  statusFilter,
  emailStatusFilter,
  routingFilter,
  campaignIdFilter,
  searchFilter,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searchInput, setSearchInput] = useState(searchFilter);
  const [showScrapeModal, setShowScrapeModal] = useState(false);

  const params: LeadsParams = {
    page,
    limit: 50,
    status: statusFilter || undefined,
    email_status: emailStatusFilter || undefined,
    routing: routingFilter || undefined,
    campaign_id: campaignIdFilter || undefined,
    search: searchFilter || undefined,
  };

  const { data: leadsResult, isFetching } = useQuery({
    ...leadsOptions(params),
    placeholderData: keepPreviousData,
  });
  const { data: globalSummary } = useQuery(leadsSummaryOptions());
  const { data: allCampaigns = [] } = useQuery(campaignsOptions());

  const data = leadsResult?.data ?? [];
  const filteredTotal = leadsResult?.total ?? 0;
  const totalPages = leadsResult?.total_pages ?? 0;

  const globalTotal = globalSummary?.total ?? 0;
  const autoQueue = globalSummary?.auto_queue ?? 0;
  const repReview = globalSummary?.rep_review ?? 0;
  const pendingEnrichment = globalSummary?.pending ?? 0;

  const scrapeMutation = useMutation({
    mutationFn: (args: Parameters<typeof scrapeLeads>[0]) => scrapeLeads(args),
    onSuccess: (result) => {
      setShowScrapeModal(false);
      if (result === null) {
        toast.error("Scrape failed — check server logs.");
      } else {
        toast.success(`Scraping ${result.queued} source${result.queued === 1 ? "" : "s"}`, {
          description: "New leads will appear here when done.",
        });
        queryClient.invalidateQueries({ queryKey: keys.leads });
      }
    },
    onError: () => toast.error("Scrape failed — check server logs."),
  });

  const enrichMutation = useMutation({
    mutationFn: () => triggerEnrichment(),
    onSuccess: (result) => {
      if (result === null) {
        toast.error("Enrichment failed — check server logs.");
        return;
      }
      if (result.queued === 0) {
        toast.info("No pending leads to enrich.");
      } else {
        toast.success(`Enriching ${result.queued} lead${result.queued === 1 ? "" : "s"}`, {
          description: "Routing will be assigned once complete.",
        });
      }
    },
    onError: () => toast.error("Enrichment failed — check server logs."),
  });

  useJobEvents((event) => {
    if (event.kind === "scrape_complete") {
      if (event.count > 0) {
        toast.success(`${event.count} new lead${event.count === 1 ? "" : "s"} added.`);
      } else {
        toast.info("Scrape complete — no new leads found.");
      }
    }
    if (event.kind === "enrichment_complete") {
      queryClient.invalidateQueries({ queryKey: keys.leads });
      if (event.count > 0) {
        toast.success(`${event.count} lead${event.count === 1 ? "" : "s"} enriched.`);
      } else {
        toast.info("Enrichment complete — no leads updated.");
      }
    }
  });

  function navigate(updates: Record<string, string | number | null>) {
    const sp = new URLSearchParams();
    const current: Record<string, string> = {
      page: String(page),
      status: statusFilter,
      email_status: emailStatusFilter,
      routing: routingFilter,
      campaign_id: campaignIdFilter,
      search: searchFilter,
    };
    const merged = { ...current, ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v === null ? "" : String(v)])) };
    for (const [key, val] of Object.entries(merged)) {
      if (val && !(key === "page" && val === "1")) sp.set(key, val);
    }
    const qs = sp.toString();
    startTransition(() => {
      router.push(`/leads${qs ? `?${qs}` : ""}`);
    });
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ search: searchInput.trim(), page: 1 });
  }

  function clearAllFilters() {
    setSearchInput("");
    navigate({ search: "", status: "", email_status: "", routing: "", campaign_id: "", page: 1 });
  }

  const hasAnyFilter = !!(searchFilter || statusFilter || emailStatusFilter || routingFilter || campaignIdFilter);

  const start = filteredTotal === 0 ? 0 : (page - 1) * 50 + 1;
  const end = Math.min(page * 50, filteredTotal);

  if (globalTotal === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-10 max-w-400 mx-auto">
        <h1 className="text-[20px] font-bold text-primary">All Leads</h1>
        <p className="mt-8 text-center text-grey-400 text-[14px]">
          No leads yet. Run a campaign scrape or import a CSV to add leads.
        </p>
      </div>
    );
  }

  return (
    <div className={`p-4 sm:p-6 lg:p-10 max-w-400 mx-auto transition-opacity duration-150 ${isPending || isFetching ? "opacity-60" : ""}`}>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-primary">All Leads</h1>
          <p className="text-[13px] text-grey-500 mt-1">{globalTotal.toLocaleString()} leads total</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <form onSubmit={submitSearch} className="flex">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, email, company…"
              className="px-3 py-2 border border-grey-200 rounded-l-lg text-[13px] w-56 focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              className="px-3 py-2 bg-primary text-white rounded-r-lg text-[13px]"
            >
              <span className="material-symbols-outlined text-[18px]">search</span>
            </button>
          </form>
          <button
            type="button"
            onClick={() => setShowScrapeModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold"
          >
            <span className="material-symbols-outlined text-[18px]">travel_explore</span>
            Run Scrape
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Matching</p>
          <h3 className="text-[28px] font-bold font-mono mt-2">{filteredTotal.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Auto Queue</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{autoQueue.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Rep Review</p>
          <h3 className="text-[28px] font-bold text-warning font-mono mt-2">{repReview.toLocaleString()}</h3>
        </div>
        <button
          type="button"
          onClick={() => enrichMutation.mutate()}
          disabled={enrichMutation.isPending || pendingEnrichment === 0}
          className="bg-white p-5 rounded-lg border border-grey-100 text-left w-full hover:border-primary transition-colors"
        >
            <div className="flex justify-between">
                <div>
                    <p className="text-[13px] text-grey-500">Pending Enrichment</p>
                    <h3 className="text-[28px] font-bold text-neutral font-mono mt-2">{pendingEnrichment.toLocaleString()}</h3>
                </div>
                <div className="flex justify-between items-start mb-3">
                    {enrichMutation.isPending ? (
                    <span className="text-[11px] font-medium text-grey-400">Running…</span>
                    ) : pendingEnrichment > 0 ? (
                    <span className="text-[11px] font-medium text-primary flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[20px]">manage_search</span>
                        Enrich
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </span>
                    ) : null}
                </div>
            </div>
        </button>
      </div>

      <div className="bg-white rounded-lg border border-grey-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-grey-100 bg-grey-50 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <select
              value={campaignIdFilter}
              onChange={(e) => navigate({ campaign_id: e.target.value, page: 1 })}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="">All Campaigns</option>
              {allCampaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={emailStatusFilter}
              onChange={(e) => navigate({ email_status: e.target.value, page: 1 })}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="">All Email Statuses</option>
              {(Object.keys(emailStatusConfig) as EmailStatus[]).map((s) => (
                <option key={s} value={s}>{emailStatusConfig[s].label}</option>
              ))}
            </select>
            <select
              value={routingFilter}
              onChange={(e) => navigate({ routing: e.target.value, page: 1 })}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="">All Routing</option>
              {(Object.keys(routingConfig) as (EnrichmentRouting | "pending")[]).map((r) => (
                <option key={r} value={r}>{routingConfig[r].label}</option>
              ))}
            </select>
             <select
              value={statusFilter}
              onChange={(e) => navigate({ status: e.target.value, page: 1 })}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="">All Statuses</option>
              {(Object.keys(statusConfig) as LeadStatus[]).map((s) => (
                <option key={s} value={s}>{statusConfig[s].label}</option>
              ))}
            </select>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="px-3 py-1.5 border border-grey-200 rounded text-[13px] text-grey-500 hover:text-primary bg-white"
              >
                Clear filters
              </button>
            )}
          </div>
          <p className="text-[13px] text-grey-500">
            {filteredTotal === 0 ? "No results" : `${start}–${end} of ${filteredTotal.toLocaleString()}`}
          </p>
        </div>

        {data.length === 0 ? (
          <div className="px-6 py-12 text-center text-grey-400 text-[13px]">
            {searchFilter ? (
              <>
                No leads match <span className="font-medium text-grey-500">&ldquo;{searchFilter}&rdquo;</span>
                {(statusFilter || emailStatusFilter || routingFilter || campaignIdFilter) ? " with the current filters." : "."}
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="ml-2 text-primary hover:underline"
                >
                  Clear filters
                </button>
              </>
            ) : (
              "No leads match these filters."
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-grey-50 border-b border-grey-100">
                <tr className="text-left">
                  <th className="px-6 py-4 text-[14px] font-semibold">Name</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Company</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Email</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Routing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-100">
                {data.map((lead) => {
                  const routeBadge = routingConfig[lead.routing ?? "pending"];
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="hover:bg-ocean-wash cursor-pointer"
                    >
                      <td className="px-6 py-3 text-[14px] font-medium">
                        {lead.name}
                      </td>
                      <td className="px-4 py-3 text-[13px]">{lead.company_name}</td>
                      <td className="px-4 py-3 text-[13px] font-mono">{lead.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${routeBadge.className}`}>
                          {routeBadge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-5 py-4 border-t border-grey-100 flex items-center justify-between">
            <p className="text-[13px] text-grey-500">
              Page {page} of {totalPages}
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => navigate({ page: p })}
            />
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadEnrichmentDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}

      {showScrapeModal && (
        <ScrapeModal
          isPending={scrapeMutation.isPending}
          onClose={() => setShowScrapeModal(false)}
          onSubmit={(args) => scrapeMutation.mutate(args)}
        />
      )}

    </div>
  );
}

// A control char that won't occur in a vertical name, used to key a
// (vertical, geoname_id) combo inside a Set without a delimiter collision.
const COMBO_SEP = String.fromCharCode(1);
const comboKey = (vertical: string, geonameId: number) => `${vertical}${COMBO_SEP}${geonameId}`;

function ScrapeModal({
  isPending,
  onClose,
  onSubmit,
}: {
  isPending: boolean;
  onClose: () => void;
  onSubmit: (args: { combos: { vertical: string; geoname_id: number }[] }) => void;
}) {
  const { data: coverage = [], isLoading } = useQuery(sourceCoverageOptions());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Tracked as collapsed-set so all verticals are expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group the flat coverage rows by vertical, each with its geos + counts.
  const groups = useMemo(() => {
    const m = new Map<string, { geoname_id: number; name: string; source_count: number }[]>();
    for (const c of coverage) {
      const arr = m.get(c.vertical) ?? [];
      arr.push({ geoname_id: c.geoname_id, name: c.geo.name, source_count: c.source_count });
      m.set(c.vertical, arr);
    }
    return Array.from(m.entries()).map(([vertical, geos]) => ({
      vertical,
      geos,
      total: geos.reduce((s, g) => s + g.source_count, 0),
    }));
  }, [coverage]);

  function toggleGeo(vertical: string, geonameId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = comboKey(vertical, geonameId);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleVertical(vertical: string, geos: { geoname_id: number }[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSel = geos.every((g) => next.has(comboKey(vertical, g.geoname_id)));
      for (const g of geos) {
        const k = comboKey(vertical, g.geoname_id);
        if (allSel) next.delete(k); else next.add(k);
      }
      return next;
    });
  }

  function toggleExpand(vertical: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(vertical)) next.delete(vertical); else next.add(vertical);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const combos = Array.from(selected).map((k) => {
      const [vertical, geonameId] = k.split(COMBO_SEP);
      return { vertical: vertical!, geoname_id: Number(geonameId) };
    });
    if (combos.length === 0) return;
    onSubmit({ combos });
  }

  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[18px] font-bold">Run Scrape</h3>
          <button type="button" onClick={onClose} className="text-grey-400 hover:text-primary text-[20px] leading-none">×</button>
        </div>
        <p className="text-[13px] text-grey-500 mb-4">
          Pick the market segments to scrape. We&apos;ll fetch leads from every active source in each selected vertical / geography.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isLoading ? (
            <p className="text-[13px] text-grey-400">Loading coverage…</p>
          ) : groups.length === 0 ? (
            <p className="text-[13px] text-grey-400">
              No scrapeable sources yet. Add sources on the Source Registry page first.
            </p>
          ) : (
            <div className="border border-grey-100 rounded-lg divide-y divide-grey-100 max-h-80 overflow-y-auto">
              {groups.map(({ vertical, geos, total }) => {
                const allSel = geos.every((g) => selected.has(comboKey(vertical, g.geoname_id)));
                const someSel = geos.some((g) => selected.has(comboKey(vertical, g.geoname_id)));
                const isOpen = !collapsed.has(vertical);
                return (
                  <div key={vertical}>
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={allSel}
                        ref={(el) => { if (el) el.indeterminate = !allSel && someSel; }}
                        onChange={() => toggleVertical(vertical, geos)}
                        className="accent-primary"
                      />
                      <button
                        type="button"
                        onClick={() => toggleExpand(vertical)}
                        className="flex-1 flex items-center justify-between text-left"
                      >
                        <span className="text-[14px] font-medium capitalize">{vertical}</span>
                        <span className="flex items-center gap-2 text-[12px] text-grey-400">
                          {total} source{total === 1 ? "" : "s"}
                          <span className="material-symbols-outlined text-[18px]">
                            {isOpen ? "expand_less" : "expand_more"}
                          </span>
                        </span>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="pb-2.5 pl-9 pr-3 flex flex-col gap-y-2">
                        {geos.map(({ geoname_id, name, source_count }) => (
                          <label key={geoname_id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected.has(comboKey(vertical, geoname_id))}
                              onChange={() => toggleGeo(vertical, geoname_id)}
                              className="accent-primary"
                            />
                            <span>{name}</span>
                            <span className="text-[11px] text-grey-400">({source_count})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[12px] text-grey-400">
            Only segments with existing sources appear here. To discover new sources for a
            configured segment, run discovery on the Source Registry page.
          </p>

          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-grey-200 rounded-lg text-[13px]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || selectedCount === 0}
              className="px-6 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-50"
            >
              {isPending
                ? "Starting…"
                : selectedCount > 0
                  ? `Scrape ${selectedCount} segment${selectedCount === 1 ? "" : "s"}`
                  : "Run Scrape"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
