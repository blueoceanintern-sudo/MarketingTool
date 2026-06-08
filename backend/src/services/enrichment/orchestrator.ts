import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  leads,
  companies,
  riskFlags,
  suppressionList,
  enrichmentRecords,
  type EnrichmentInstitution,
  type EnrichmentContact,
  type EnrichmentPipelineFlags,
} from "../../db/schema";
import { registryProvider } from "./registryLookup";
import { coworkProvider } from "./cowork";
import { snovioProvider } from "./snovio";
import { appendEnrichmentRecord } from "./ndjsonWriter";
import type {
  EnrichmentInput,
  EnrichmentProvider,
  EnrichmentRecord,
  EnrichmentRouting,
  EnrichmentSource,
  Market,
  ProviderResult,
} from "./types";

// PRD §5.4 source priority: registry → cowork (Claude in Chrome) → snovio.
const PROVIDERS: EnrichmentProvider[] = [registryProvider, coworkProvider, snovioProvider];

const REQUIRED_FIELDS = [
  "institution.name",
  "institution.type",
  "contact.email",
  "contact.email_status",
] as const;

export async function enrichLead(leadId: string): Promise<{ record: EnrichmentRecord; fullyEnriched: boolean }> {
  const input = await buildInput(leadId);

  let primarySource: EnrichmentSource = "manual";
  const institution: Partial<EnrichmentInstitution> = {};
  // Seed contact with whatever the scraper already found so enrichment always
  // produces a record — providers upgrade fields rather than starting from scratch.
  const contact: Partial<EnrichmentContact> = {
    email: input.seed.email ?? undefined,
    email_status: input.seed.email ? "pattern_guessed" : undefined,
    full_name: [input.seed.firstName, input.seed.lastName].filter(Boolean).join(" ") || undefined,
    first_name: input.seed.firstName ?? undefined,
    role: input.seed.role ?? undefined,
  };

  for (const provider of PROVIDERS) {
    const result = await provider.enrich(input).catch((err) => {
      console.error(`[enrichment] ${provider.name} failed for lead ${leadId}:`, err);
      return null;
    });
    if (!result) continue;

    mergeProviderResult({ institution, contact }, result);

    if (primarySource === "manual") primarySource = result.source;
    if (contact.email_status === "verified") break;
  }

  if (!contact.email) {
    throw new Error(`[enrichment] no email available for lead ${leadId} — skipping`);
  }

  const finalInstitution = finalizeInstitution(institution, input);
  const finalContact = finalizeContact(contact);
  const pipelineFlags = await computePipelineFlags(input, finalContact);
  const { routing, reason } = computeRouting(finalContact, pipelineFlags);

  const record: EnrichmentRecord = {
    lead_id: leadId,
    enriched_at: new Date().toISOString(),
    enrichment_source: primarySource,
    market: input.market,
    institution: finalInstitution,
    contact: finalContact,
    pipeline_flags: pipelineFlags,
    routing,
    routing_reason: reason,
  };

  const fullyEnriched = await persist(record, input.campaignId);
  return { record, fullyEnriched };
}

async function buildInput(leadId: string): Promise<EnrichmentInput> {
  // With lead↔campaign m:n, a lead can belong to many campaigns with
  // different geos. Market is resolved from company.location only —
  // company.location is already set by scrape/CSV import from the
  // originating campaign's geo, so the signal is equivalent.
  const [row] = await db
    .select({
      leadId: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      role: leads.role,
      companyName: companies.name,
      industry: companies.industry,
      location: companies.location,
      companySource: companies.source,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!row) throw new Error(`Lead not found: ${leadId}`);

  const market = resolveMarket(null, row.location);

  return {
    leadId: row.leadId,
    // Lead↔campaign is m:n; enrichment is per-lead, not per-campaign. The
    // enrichment_records.campaign_id column stays nullable for this reason.
    campaignId: null,
    market,
    seed: {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      role: row.role,
      companyName: row.companyName,
      companyWebsite: row.companySource ?? null,
      industry: row.industry,
      region: market,
    },
  };
}

function resolveMarket(campaignGeography: string | null, location: string): Market {
  const tokens = [campaignGeography, location]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toUpperCase();
  if (tokens.includes("SG") || tokens.includes("SINGAPORE")) return "SG";
  if (tokens.includes("AU") || tokens.includes("AUSTRALIA")) return "AU";
  return "US";
}

function mergeProviderResult(
  acc: { institution: Partial<EnrichmentInstitution>; contact: Partial<EnrichmentContact> },
  result: ProviderResult,
): void {
  if (result.institution) {
    for (const [k, v] of Object.entries(result.institution)) {
      const key = k as keyof EnrichmentInstitution;
      if (acc.institution[key] == null && v != null) {
        (acc.institution as Record<string, unknown>)[key] = v;
      }
    }
  }
  if (result.contact) {
    for (const [k, v] of Object.entries(result.contact)) {
      const key = k as keyof EnrichmentContact;
      if (acc.contact[key] == null && v != null) {
        (acc.contact as Record<string, unknown>)[key] = v;
      }
    }
    // email_status from a stronger provider overrides a weaker one
    if (result.contact.email_status === "verified") {
      acc.contact.email_status = "verified";
    }
  }
}

function finalizeInstitution(
  partial: Partial<EnrichmentInstitution>,
  input: EnrichmentInput,
): EnrichmentInstitution {
  return {
    name: partial.name ?? input.seed.companyName,
    type: partial.type ?? "unknown",
    registration_id: partial.registration_id ?? null,
    size: partial.size ?? "unknown",
    website: partial.website ?? input.seed.companyWebsite ?? null,
    region: partial.region ?? input.seed.region,
  };
}

function finalizeContact(partial: Partial<EnrichmentContact>): EnrichmentContact {
  return {
    full_name: partial.full_name ?? null,
    first_name: partial.first_name ?? null,
    role: partial.role ?? null,
    email: partial.email ?? null,
    email_status: partial.email_status ?? "not_found",
  };
}

async function computePipelineFlags(
  input: EnrichmentInput,
  contact: EnrichmentContact,
): Promise<EnrichmentPipelineFlags> {
  const missing: string[] = [];
  if (!contact.email) missing.push("contact.email");
  for (const field of REQUIRED_FIELDS) {
    // contact.email_status defaults to 'not_found' so it's always present;
    // institution name is filled from seed; type defaults to 'unknown'.
    if (field === "contact.email" && !contact.email) continue; // already counted
    if (field === "institution.type" && contact.email_status === "not_found") {
      // skip — institution.type 'unknown' shouldn't block when contact is the bigger gap
    }
  }
  if (!input.seed.companyName) missing.push("institution.name");

  const isDuplicate = await isDuplicateContact(input.seed.email);
  const { flagged, reason } = await hasRiskFlag(input.leadId);

  return {
    is_duplicate: isDuplicate,
    missing_critical_fields: missing.length > 0,
    missing_fields_detail: missing,
    risk_flag: flagged,
    risk_flag_reason: reason,
  };
}

async function isDuplicateContact(email: string | null): Promise<boolean> {
  if (!email) return false;

  const [suppressed] = await db
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(eq(suppressionList.email, email))
    .limit(1);

  return Boolean(suppressed);
}

async function hasRiskFlag(leadId: string): Promise<{ flagged: boolean; reason: string | null }> {
  const [flag] = await db
    .select({ flagType: riskFlags.flagType })
    .from(riskFlags)
    .where(eq(riskFlags.leadId, leadId))
    .limit(1);
  return { flagged: Boolean(flag), reason: flag?.flagType ?? null };
}

function computeRouting(
  contact: EnrichmentContact,
  flags: EnrichmentPipelineFlags,
): { routing: EnrichmentRouting; reason: string | null } {
  if (flags.is_duplicate) return { routing: "rep_review", reason: "duplicate_contact" };
  if (flags.risk_flag) return { routing: "rep_review", reason: flags.risk_flag_reason ?? "risk_flag" };
  if (flags.missing_critical_fields) {
    return { routing: "rep_review", reason: `missing:${flags.missing_fields_detail.join(",")}` };
  }
  if (contact.email_status !== "verified") {
    return { routing: "rep_review", reason: `email_status:${contact.email_status}` };
  }
  return { routing: "auto_queue", reason: null };
}

async function persist(record: EnrichmentRecord, campaignId: string | null): Promise<boolean> {
  const { first_name, full_name, role, email } = record.contact;

  // Derive last name from full_name by removing first_name prefix
  let lastName: string | null = null;
  if (full_name && first_name) {
    const rest = full_name.slice(first_name.length).trim();
    lastName = rest || null;
  } else if (full_name && !first_name) {
    const spaceIdx = full_name.indexOf(" ");
    lastName = spaceIdx !== -1 ? full_name.slice(spaceIdx + 1).trim() : null;
  }

  // Only mark the lead as fully enriched if all key contact fields are present
  const fullyEnriched = Boolean(first_name && lastName && role && email);

  await db.transaction(async (tx) => {
    await tx.insert(enrichmentRecords).values({
      leadId: record.lead_id,
      campaignId,
      enrichedAt: new Date(record.enriched_at),
      enrichmentSource: record.enrichment_source,
      market: record.market,
      institution: record.institution,
      contact: record.contact,
      pipelineFlags: record.pipeline_flags,
      routing: record.routing,
      routingReason: record.routing_reason,
    });

    await tx
      .update(leads)
      .set({
        ...(first_name ? { firstName: first_name } : {}),
        ...(lastName ? { lastName } : {}),
        ...(role ? { role } : {}),
        ...(email ? { email } : {}),
        emailStatus: record.contact.email_status,
        enrichmentSource: record.enrichment_source,
        routing: record.routing,
        ...(fullyEnriched ? { enrichedAt: new Date(record.enriched_at) } : {}),
        isVerified: record.contact.email_status === "verified",
        updatedAt: new Date(),
      })
      .where(eq(leads.id, record.lead_id));
  });

  await appendEnrichmentRecord(record);
  return fullyEnriched;
}
