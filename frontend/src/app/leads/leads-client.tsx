"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  scrapeLeads,
  type EmailStatus,
  type EnrichmentRouting,
  type EnrichmentSource,
  type Lead,
  type LeadStatus,
} from "@/lib/api";
import { leadsOptions, leadEnrichmentOptions, campaignsOptions, sourceCoverageOptions, keys, type LeadsParams } from "@/lib/queries";
import Pagination from "@/components/pagination";

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  new:        { label: "New",        className: "bg-secondary-fixed text-on-secondary-fixed-variant" },
  contacted:  { label: "Contacted",  className: "bg-ocean-wash text-primary" },
  replied:    { label: "Replied",    className: "bg-warning-bg text-warning" },
  converted:  { label: "Converted",  className: "bg-success-bg text-success" },
  suppressed: { label: "Suppressed", className: "bg-neutral-bg text-neutral" },
};

const emailStatusConfig: Record<EmailStatus, { label: string; className: string }> = {
  verified:        { label: "Verified",   className: "bg-success-bg text-success" },
  pattern_guessed: { label: "Pattern Guessed",    className: "bg-warning-bg text-warning" },
  not_found:       { label: "Not found",  className: "bg-neutral-bg text-neutral" },
};

const routingConfig: Record<EnrichmentRouting, { label: string; className: string }> = {
  auto_queue: { label: "Auto Queue", className: "bg-success-bg text-success" },
  rep_review: { label: "Rep Review", className: "bg-warning-bg text-warning" },
};

const sourceLabel: Record<EnrichmentSource, string> = {
  registry:      "Registry",
  cowork_claude: "Cowork",
  snovio:        "Snov.io",
  manual:        "Manual",
};

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
  const [toast, setToast] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(searchFilter);
  const [showScrapeModal, setShowScrapeModal] = useState(false);

  // Build the same params object the server prefetched with, so the query key
  // matches and hydration is reused (no refetch on first paint).
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
  const { data: allCampaigns = [] } = useQuery(campaignsOptions());

  const data = leadsResult?.data ?? [];
  const total = leadsResult?.total ?? 0;
  const totalPages = leadsResult?.total_pages ?? 0;
  const summary = leadsResult?.summary ?? { auto_queue: 0, rep_review: 0, pending: 0 };

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  const scrapeMutation = useMutation({
    mutationFn: (args: Parameters<typeof scrapeLeads>[0]) => scrapeLeads(args),
    onSuccess: (result) => {
      setShowScrapeModal(false);
      if (result === null) {
        showToast("Scrape failed — check server logs.");
      } else {
        showToast(`Scraping ${result.queued} source${result.queued === 1 ? "" : "s"} in the background.`);
        queryClient.invalidateQueries({ queryKey: keys.leads });
      }
    },
    onError: () => showToast("Scrape failed — check server logs."),
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

  const start = total === 0 ? 0 : (page - 1) * 50 + 1;
  const end = Math.min(page * 50, total);

  if (total === 0 && !statusFilter && !emailStatusFilter && !routingFilter && !campaignIdFilter && !searchFilter) {
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
          <p className="text-[13px] text-grey-500 mt-1">{total.toLocaleString()} leads total</p>
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
          {searchFilter && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); navigate({ search: "", page: 1 }); }}
              className="px-3 py-2 border border-grey-200 rounded-lg text-[13px] text-grey-500 hover:text-primary"
            >
              Clear
            </button>
          )}
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
          <h3 className="text-[28px] font-bold font-mono mt-2">{total.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Auto Queue</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{summary.auto_queue.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Rep Review</p>
          <h3 className="text-[28px] font-bold text-warning font-mono mt-2">{summary.rep_review.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Pending Enrichment</p>
          <h3 className="text-[28px] font-bold text-neutral font-mono mt-2">{summary.pending.toLocaleString()}</h3>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-grey-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-grey-100 bg-grey-50 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2">
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
              {(Object.keys(routingConfig) as EnrichmentRouting[]).map((r) => (
                <option key={r} value={r}>{routingConfig[r].label}</option>
              ))}
              <option value="pending">Pending Enrichment</option>
            </select>
          </div>
          <p className="text-[13px] text-grey-500">
            {total === 0 ? "No results" : `${start}–${end} of ${total.toLocaleString()}`}
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
                  onClick={() => { setSearchInput(""); navigate({ search: "", page: 1 }); }}
                  className="ml-2 text-primary hover:underline"
                >
                  Clear search
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
                  const routeBadge = lead.routing ? routingConfig[lead.routing] : null;
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
                        {routeBadge ? (
                          <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${routeBadge.className}`}>
                            {routeBadge.label}
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 text-xs font-bold rounded-full bg-neutral-bg text-neutral"
                            title="Awaiting enrichment — routing is assigned once the lead is enriched"
                          >
                            Pending
                          </span>
                        )}
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
        <EnrichmentDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}

      {showScrapeModal && (
        <ScrapeModal
          isPending={scrapeMutation.isPending}
          onClose={() => setShowScrapeModal(false)}
          onSubmit={(args) => scrapeMutation.mutate(args)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-primary text-white px-4 py-3 rounded-lg shadow-lg text-[14px] max-w-xs">
          {toast}
        </div>
      )}
    </div>
  );
}

// A control char that won't occur in a vertical/geo, used to key a
// (vertical, geo) combo inside a Set without a delimiter collision.
const COMBO_SEP = String.fromCharCode(1);
const comboKey = (vertical: string, geo: string) => `${vertical}${COMBO_SEP}${geo}`;

function ScrapeModal({
  isPending,
  onClose,
  onSubmit,
}: {
  isPending: boolean;
  onClose: () => void;
  onSubmit: (args: { combos: { vertical: string; geo: string }[] }) => void;
}) {
  const { data: coverage = [], isLoading } = useQuery(sourceCoverageOptions());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Tracked as collapsed-set so all verticals are expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group the flat coverage rows by vertical, each with its geos + counts.
  const groups = useMemo(() => {
    const m = new Map<string, { geo: string; source_count: number }[]>();
    for (const c of coverage) {
      const arr = m.get(c.vertical) ?? [];
      arr.push({ geo: c.geo, source_count: c.source_count });
      m.set(c.vertical, arr);
    }
    return Array.from(m.entries()).map(([vertical, geos]) => ({
      vertical,
      geos,
      total: geos.reduce((s, g) => s + g.source_count, 0),
    }));
  }, [coverage]);

  function toggleGeo(vertical: string, geo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = comboKey(vertical, geo);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleVertical(vertical: string, geos: { geo: string }[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSel = geos.every((g) => next.has(comboKey(vertical, g.geo)));
      for (const g of geos) {
        const k = comboKey(vertical, g.geo);
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
      const [vertical, geo] = k.split(COMBO_SEP);
      return { vertical: vertical!, geo: geo! };
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
                const allSel = geos.every((g) => selected.has(comboKey(vertical, g.geo)));
                const someSel = geos.some((g) => selected.has(comboKey(vertical, g.geo)));
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
                        {geos.map(({ geo, source_count }) => (
                          <label key={geo} className="flex items-center gap-2 text-[13px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected.has(comboKey(vertical, geo))}
                              onChange={() => toggleGeo(vertical, geo)}
                              className="accent-primary"
                            />
                            <span>{geo}</span>
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

function EnrichmentDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { data: record, isLoading: loading } = useQuery(leadEnrichmentOptions(lead.id));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-120 bg-white h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-grey-100 flex justify-between items-start">
          <div>
            <h2 className="text-[16px] font-bold text-primary">{lead.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[12px] text-grey-500 font-mono">{lead.email}</p>
              {lead.email_status && (
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${emailStatusConfig[lead.email_status].className}`}>
                  {emailStatusConfig[lead.email_status].label}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-grey-400 hover:text-primary text-[18px] leading-none hover:cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <Section title="Overview">
            <Field label="Company" value={lead.company_name || "—"} />
            <Field label="Role" value={lead.role || "—"} />
            <div className="flex justify-between text-[13px] gap-4">
              <span className="text-grey-500 whitespace-nowrap">Status</span>
              <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${statusConfig[lead.status].className}`}>
                {statusConfig[lead.status].label}
              </span>
            </div>
            {lead.company_source && (
              <div className="flex justify-between text-[13px] gap-4">
                <span className="text-grey-500 whitespace-nowrap">Scraped from</span>
                <a
                  href={lead.company_source}
                  target="_blank"
                  rel="noreferrer"
                  title={lead.company_source}
                  className="font-mono text-right text-ocean-light hover:underline truncate max-w-[60%]"
                >
                  {lead.company_source}
                </a>
              </div>
            )}
          </Section>

          <Section title="Campaigns">
            {lead.campaigns.length === 0 ? (
              <p className="text-[13px] text-grey-400">Not assigned to any campaign.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {lead.campaigns.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-ocean-wash text-primary text-[11px] font-medium"
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section title="Acquisition">
            <Field label="Scraper" value={lead.scraper_used ?? "manual / CSV import"} />
          </Section>

          {loading ? (
            <p className="text-[13px] text-grey-400">Loading enrichment record…</p>
          ) : !record ? (
            <p className="text-[13px] text-grey-400">No enrichment record yet for this lead.</p>
          ) : (
            <>
              <Section title="Enrichment">
                <Field label="Source" value={sourceLabel[record.enrichment_source]} />
                <Field label="Market" value={record.market} />
                <Field label="Enriched at" value={new Date(record.enriched_at).toLocaleString()} />
                <Field
                  label="Routing"
                  value={`${routingConfig[record.routing].label}${record.routing_reason ? ` (${record.routing_reason})` : ""}`}
                />
              </Section>

              <Section title="Institution">
                <Field label="Name" value={record.institution.name} />
                <Field label="Type" value={record.institution.type} />
                <Field label="Registration ID" value={record.institution.registration_id ?? "—"} />
                <Field label="Size" value={record.institution.size} />
                <Field label="Website" value={record.institution.website ?? "—"} />
                <Field label="Region" value={record.institution.region} />
              </Section>

              <Section title="Contact">
                <Field label="Full name" value={record.contact.full_name ?? "—"} />
                <Field label="Role" value={record.contact.role ?? "—"} />
                <Field label="Email" value={record.contact.email ?? "—"} mono />
                <Field
                  label="Email status"
                  value={emailStatusConfig[record.contact.email_status].label}
                />
              </Section>

              <Section title="Pipeline flags">
                <Field label="Duplicate" value={record.pipeline_flags.is_duplicate ? "yes" : "no"} />
                <Field
                  label="Missing critical fields"
                  value={record.pipeline_flags.missing_critical_fields ? "yes" : "no"}
                />
                {record.pipeline_flags.missing_fields_detail.length > 0 && (
                  <Field
                    label="Missing"
                    value={record.pipeline_flags.missing_fields_detail.join(", ")}
                  />
                )}
                <Field label="Risk flag" value={record.pipeline_flags.risk_flag ? "yes" : "no"} />
                {record.pipeline_flags.risk_flag_reason && (
                  <Field label="Risk reason" value={record.pipeline_flags.risk_flag_reason} />
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-grey-500 mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-[13px] gap-4">
      <span className="text-grey-500 whitespace-nowrap">{label}</span>
      <span className={mono ? "font-mono text-right" : "text-right"}>{value}</span>
    </div>
  );
}
