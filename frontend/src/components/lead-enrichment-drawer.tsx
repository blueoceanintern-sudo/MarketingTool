"use client";

import { useQuery } from "@tanstack/react-query";
import { type Lead, type LeadStatus, type EmailStatus, type EnrichmentRouting, type EnrichmentSource } from "@/lib/api";
import { leadEnrichmentOptions } from "@/lib/queries";

export const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  new:        { label: "New",        className: "bg-secondary-fixed text-on-secondary-fixed-variant" },
  contacted:  { label: "Contacted",  className: "bg-ocean-wash text-primary" },
  replied:    { label: "Replied",    className: "bg-warning-bg text-warning" },
  converted:  { label: "Converted",  className: "bg-success-bg text-success" },
  suppressed: { label: "Suppressed", className: "bg-neutral-bg text-neutral" },
};

export const emailStatusConfig: Record<EmailStatus, { label: string; className: string }> = {
  verified:        { label: "Verified",       className: "bg-success-bg text-success" },
  pattern_guessed: { label: "Pattern Guessed", className: "bg-warning-bg text-warning" },
  not_found:       { label: "Not found",      className: "bg-neutral-bg text-neutral" },
};

export const routingConfig: Record<EnrichmentRouting, { label: string; className: string }> = {
  auto_queue: { label: "Auto Queue", className: "bg-success-bg text-success" },
  rep_review: { label: "Rep Review", className: "bg-warning-bg text-warning" },
};

export const sourceLabel: Record<EnrichmentSource, string> = {
  registry:      "Registry",
  cowork_claude: "Cowork",
  snovio:        "Snov.io",
  manual:        "Manual",
};

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-grey-500 mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-[13px] gap-4">
      <span className="text-grey-500 whitespace-nowrap">{label}</span>
      <span className={mono ? "font-mono text-right" : "text-right"}>{value}</span>
    </div>
  );
}

export function LeadEnrichmentDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
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
            {lead.company_industry && lead.company_industry !== "general" && (
              <Field label="Vertical" value={lead.company_industry} />
            )}
            {lead.company_location && lead.company_location !== "unknown" && (
              <Field label="Geo" value={lead.company_location} />
            )}
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
              <div className="space-y-1.5">
                {lead.campaigns.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-ocean-wash text-primary text-[11px] font-medium truncate">
                      {c.name}
                    </span>
                    <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full ${statusConfig[c.status].className}`}>
                      {statusConfig[c.status].label}
                    </span>
                  </div>
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
