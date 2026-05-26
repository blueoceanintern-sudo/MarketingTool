"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getLeadEnrichment,
  type EmailStatus,
  type EnrichmentRecord,
  type EnrichmentRouting,
  type EnrichmentSource,
  type Lead,
  type LeadStatus,
} from "@/lib/api";

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-secondary-fixed text-on-secondary-fixed-variant" },
  contacted: { label: "Contacted", className: "bg-ocean-wash text-primary" },
  replied: { label: "Replied", className: "bg-warning-bg text-warning" },
  converted: { label: "Converted", className: "bg-success-bg text-success" },
  suppressed: { label: "Suppressed", className: "bg-neutral-bg text-neutral" },
};

const emailStatusConfig: Record<EmailStatus, { label: string; className: string }> = {
  verified: { label: "Verified", className: "bg-success-bg text-success" },
  pattern_guessed: { label: "Guessed", className: "bg-warning-bg text-warning" },
  not_found: { label: "Not found", className: "bg-neutral-bg text-neutral" },
};

const routingConfig: Record<EnrichmentRouting, { label: string; className: string }> = {
  auto_queue: { label: "Auto queue", className: "bg-success-bg text-success" },
  rep_review: { label: "Rep review", className: "bg-warning-bg text-warning" },
};

const sourceLabel: Record<EnrichmentSource, string> = {
  registry: "Registry",
  cowork_claude: "Cowork",
  snovio: "Snov.io",
  manual: "Manual",
};

interface Props {
  initialLeads: Lead[];
}

export default function LeadsClient({ initialLeads }: Props) {
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [emailStatusFilter, setEmailStatusFilter] = useState<EmailStatus | "all">("all");
  const [routingFilter, setRoutingFilter] = useState<EnrichmentRouting | "all">("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const campaigns = useMemo(() => {
    const names = new Set(initialLeads.map((l) => l.campaign_name).filter(Boolean) as string[]);
    return Array.from(names).sort();
  }, [initialLeads]);

  const filtered = useMemo(() => {
    return initialLeads.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (campaignFilter !== "all" && lead.campaign_name !== campaignFilter) return false;
      if (emailStatusFilter !== "all" && lead.email_status !== emailStatusFilter) return false;
      if (routingFilter !== "all" && lead.routing !== routingFilter) return false;
      return true;
    });
  }, [initialLeads, statusFilter, campaignFilter, emailStatusFilter, routingFilter]);

  const totalVerified = filtered.filter((l) => l.email_status === "verified").length;
  const totalAutoQueue = filtered.filter((l) => l.routing === "auto_queue").length;
  const totalRepReview = filtered.filter((l) => l.routing === "rep_review").length;

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
          <p className="text-[13px] text-grey-500">Verified email</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{totalVerified}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Auto queue</p>
          <h3 className="text-[28px] font-bold text-success font-mono mt-2">{totalAutoQueue}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Rep review</p>
          <h3 className="text-[28px] font-bold text-warning font-mono mt-2">{totalRepReview}</h3>
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
                <option key={s} value={s}>{statusConfig[s].label}</option>
              ))}
            </select>
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="all">All Campaigns</option>
              {campaigns.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <select
              value={emailStatusFilter}
              onChange={(e) => setEmailStatusFilter(e.target.value as EmailStatus | "all")}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="all">All Email Statuses</option>
              {(Object.keys(emailStatusConfig) as EmailStatus[]).map((s) => (
                <option key={s} value={s}>{emailStatusConfig[s].label}</option>
              ))}
            </select>
            <select
              value={routingFilter}
              onChange={(e) => setRoutingFilter(e.target.value as EnrichmentRouting | "all")}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="all">All Routing</option>
              {(Object.keys(routingConfig) as EnrichmentRouting[]).map((r) => (
                <option key={r} value={r}>{routingConfig[r].label}</option>
              ))}
            </select>
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
                <th className="px-4 py-4 text-[14px] font-semibold">Email Status</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Routing</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Source</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Campaign</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {filtered.map((lead) => {
                const badge = statusConfig[lead.status];
                const emailBadge = lead.email_status ? emailStatusConfig[lead.email_status] : null;
                const routeBadge = lead.routing ? routingConfig[lead.routing] : null;
                return (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className="hover:bg-ocean-wash cursor-pointer"
                  >
                    <td className="px-6 py-3 text-[14px] font-medium">
                      {lead.first_name} {lead.last_name}
                    </td>
                    <td className="px-4 py-3 text-[13px]">{lead.company_name}</td>
                    <td className="px-4 py-3 text-[13px] font-mono">{lead.email}</td>
                    <td className="px-4 py-3">
                      {emailBadge ? (
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${emailBadge.className}`}>
                          {emailBadge.label}
                        </span>
                      ) : <span className="text-grey-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {routeBadge ? (
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${routeBadge.className}`}>
                          {routeBadge.label}
                        </span>
                      ) : <span className="text-grey-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-grey-500">
                      {lead.enrichment_source ? sourceLabel[lead.enrichment_source] : "—"}
                    </td>
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

      {selectedLead && (
        <EnrichmentDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  );
}

function EnrichmentDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [record, setRecord] = useState<EnrichmentRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeadEnrichment(lead.id).then((r) => {
      if (!cancelled) {
        setRecord(r);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [lead.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-[480px] bg-white h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-grey-100 flex justify-between items-start">
          <div>
            <h2 className="text-[16px] font-bold text-primary">{lead.first_name} {lead.last_name}</h2>
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
