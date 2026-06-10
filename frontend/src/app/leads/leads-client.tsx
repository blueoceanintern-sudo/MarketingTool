"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  triggerEnrichment,
  scrapeLeads,
  createRegistrySource,
  type EmailStatus,
  type EnrichmentRouting,
  type EnrichmentSource,
  type Lead,
  type LeadStatus,
  type SourceRegistry,
} from "@/lib/api";
import { leadsOptions, leadEnrichmentOptions, campaignsOptions, registrySourcesOptions, keys, type LeadsParams } from "@/lib/queries";
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
  pattern_guessed: { label: "Guessed",    className: "bg-warning-bg text-warning" },
  not_found:       { label: "Not found",  className: "bg-neutral-bg text-neutral" },
};

const routingConfig: Record<EnrichmentRouting, { label: string; className: string }> = {
  auto_queue: { label: "Auto queue", className: "bg-success-bg text-success" },
  rep_review: { label: "Rep review", className: "bg-warning-bg text-warning" },
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
  const { data: rawCampaigns = [] } = useQuery(campaignsOptions());
  const allCampaigns = useMemo(() => [...rawCampaigns].sort((a, b) => a.name.localeCompare(b.name)), [rawCampaigns]);
  const { data: sourcesResult } = useQuery(registrySourcesOptions({ limit: 200 }));
  const allSources = sourcesResult?.data ?? [];

  const data = leadsResult?.data ?? [];
  const total = leadsResult?.total ?? 0;
  const totalPages = leadsResult?.total_pages ?? 0;
  const summary = leadsResult?.summary ?? { verified: 0, auto_queue: 0, rep_review: 0 };

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

  const enrichMutation = useMutation({
    mutationFn: () => triggerEnrichment(),
    onSuccess: (result) => {
      if (result === null) {
        showToast("Failed to start enrichment — check server logs.");
      } else if (result.queued === 0) {
        showToast("No scraped leads to enrich.");
      } else {
        showToast(`Enrichment started for ${result.queued} lead${result.queued === 1 ? "" : "s"}.`);
        // Enrichment runs in the background; refetch the list so newly enriched
        // leads surface once the worker finishes and the user refocuses.
        queryClient.invalidateQueries({ queryKey: keys.leads });
      }
    },
    onError: () => showToast("Failed to start enrichment — check server logs."),
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

  if (total === 0 && !statusFilter && !emailStatusFilter && !routingFilter && !campaignIdFilter) {
    return (
      <div className="p-4 sm:p-6 lg:p-10 max-w-[1600px] mx-auto">
        <h1 className="text-[20px] font-bold text-primary">All Leads</h1>
        <p className="mt-8 text-center text-grey-400 text-[14px]">
          No leads yet. Run a campaign scrape or import a CSV to add leads.
        </p>
      </div>
    );
  }

  return (
    <div className={`p-4 sm:p-6 lg:p-10 max-w-[1600px] mx-auto transition-opacity duration-150 ${isPending || isFetching ? "opacity-60" : ""}`}>
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
            Fetch Leads
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Matching</p>
          <h3 className="text-[28px] font-bold font-mono mt-2">{total.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Verified email</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{summary.verified.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Auto queue</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{summary.auto_queue.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Rep review</p>
          <h3 className="text-[28px] font-bold text-warning font-mono mt-2">{summary.rep_review.toLocaleString()}</h3>
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
            </select>
          </div>
          <p className="text-[13px] text-grey-500">
            {total === 0 ? "No results" : `${start}–${end} of ${total.toLocaleString()}`}
          </p>
        </div>

        {data.length === 0 ? (
          <p className="px-6 py-12 text-center text-grey-400">No leads match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-grey-50 border-b border-grey-100">
                <tr className="text-left">
                  <th className="px-6 py-4 text-[14px] font-semibold">Name</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Company</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Campaign</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Email</th>
                  <th className="px-4 py-4 text-[14px] font-semibold text-center">Verified</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Routing</th>
                  <th className="px-4 py-4 text-[14px] font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-100">
                {data.map((lead) => {
                  const badge = statusConfig[lead.status];
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
                      <td className="px-4 py-3 text-[12px] text-grey-500">
                        {lead.campaigns.length === 0 ? (
                          "—"
                        ) : (
                          <div className="flex flex-wrap gap-1">
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
                      </td>
                      <td className="px-4 py-3 text-[13px] font-mono">{lead.email}</td>
                      <td className="px-4 py-3 text-center">
                        {lead.is_verified ? (
                          <span className="material-symbols-outlined text-success text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            verified
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-grey-300 text-[18px]">verified</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {routeBadge ? (
                          <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${routeBadge.className}`}>
                            {routeBadge.label}
                          </span>
                        ) : <span className="text-grey-400 text-xs">—</span>}
                      </td>
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
          sources={allSources}
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

type ScrapeMode = "registry" | "urls" | "both";

function ScrapeModal({
  sources,
  isPending,
  onClose,
  onSubmit,
}: {
  sources: SourceRegistry[];
  isPending: boolean;
  onClose: () => void;
  onSubmit: (args: { source_ids?: string[]; urls?: string[]; scraper_type?: "cheerio" | "crawl4ai" }) => void;
}) {
  const [mode, setMode] = useState<ScrapeMode>("registry");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [urlsText, setUrlsText] = useState("");
  const [scraperType, setScraperType] = useState<"cheerio" | "crawl4ai">("cheerio");

  const activeSources = sources.filter((s) => s.active);

  function toggleSource(id: string) {
    setSelectedSourceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const urls = urlsText.split("\n").map((u) => u.trim()).filter(Boolean);
    const source_ids = selectedSourceIds;

    if ((mode === "registry" || mode === "both") && source_ids.length === 0) return;
    if ((mode === "urls" || mode === "both") && urls.length === 0) return;

    onSubmit({
      source_ids: mode === "urls" ? undefined : source_ids,
      urls: mode === "registry" ? undefined : urls,
      scraper_type: scraperType,
    });
  }

  const showRegistry = mode === "registry" || mode === "both";
  const showUrls = mode === "urls" || mode === "both";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[18px] font-bold">Fetch Leads</h3>
          <button type="button" onClick={onClose} className="text-grey-400 hover:text-primary text-[20px] leading-none">×</button>
        </div>

        <div className="flex gap-2 mb-5">
          {(["registry", "urls", "both"] as ScrapeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                "px-3 py-1.5 rounded text-[13px] font-medium border",
                mode === m ? "bg-primary text-white border-primary" : "bg-white border-grey-200 text-grey-600",
              ].join(" ")}
            >
              {m === "registry" ? "Source Registry" : m === "urls" ? "Custom URLs" : "Both"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {showRegistry && (
            <div>
              <p className="text-[12px] font-semibold text-grey-500 uppercase tracking-wide mb-2">
                Select registry sources
              </p>
              {activeSources.length === 0 ? (
                <p className="text-[13px] text-grey-400">No active sources in the registry.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto border border-grey-100 rounded-lg p-2">
                  {activeSources.map((s) => (
                    <label key={s.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-grey-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.includes(s.id)}
                        onChange={() => toggleSource(s.id)}
                        className="accent-primary"
                      />
                      <span className="text-[13px] flex-1">{s.name}</span>
                      <span className="text-[11px] text-grey-400">{s.geo} · {s.vertical}</span>
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  setSelectedSourceIds(
                    selectedSourceIds.length === activeSources.length ? [] : activeSources.map((s) => s.id)
                  )
                }
                className="mt-1.5 text-[12px] text-primary hover:underline"
              >
                {selectedSourceIds.length === activeSources.length ? "Deselect all" : "Select all"}
              </button>
            </div>
          )}

          {showUrls && (
            <div>
              <label className="block text-[12px] font-semibold text-grey-500 uppercase tracking-wide mb-1.5">
                Custom URLs <span className="font-normal normal-case">(one per line)</span>
              </label>
              <textarea
                rows={4}
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder={"https://example.com/staff\nhttps://school.edu/contacts"}
                className="w-full border border-grey-200 rounded-lg px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-primary"
              />
              <label className="flex items-center gap-2 mt-2 text-[13px]">
                <span className="text-grey-500">Scraper:</span>
                <select
                  value={scraperType}
                  onChange={(e) => setScraperType(e.target.value as "cheerio" | "crawl4ai")}
                  className="border border-grey-200 rounded px-2 py-1 text-[13px]"
                >
                  <option value="cheerio">Cheerio (static HTML)</option>
                  <option value="crawl4ai">Crawl4AI (JS-rendered)</option>
                </select>
              </label>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-grey-200 rounded-lg text-[13px]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-6 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-50"
            >
              {isPending ? "Starting…" : "Run Scrape"}
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
        className="relative w-[480px] bg-white h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-grey-100 flex justify-between items-start">
          <div>
            <h2 className="text-[16px] font-bold text-primary">{lead.name}</h2>
            <p className="text-[12px] text-grey-500 font-mono">{lead.email}</p>
          </div>
          <button
            onClick={onClose}
            className="text-grey-400 hover:text-primary text-[18px] leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
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
