import type {
  EnrichmentInstitution,
  EnrichmentContact,
  EnrichmentPipelineFlags,
} from "../../db/schema/tables";

// UNKNOWN covers companies outside the three target markets, and companies
// whose location hasn't been resolved to a geoname_id yet (see
// backfill-company-geo.ts) — we no longer default an unresolved location to
// "US", since that silently applied CAN-SPAM logic to a lead a different
// legal regime (PDPA/Privacy Act) might actually apply to.
export type Market = "SG" | "AU" | "US" | "UNKNOWN";
export type EmailStatus = "verified" | "pattern_guessed" | "not_found";
export type EnrichmentSource = "registry" | "cowork_claude" | "snovio" | "manual";
export type EnrichmentRouting = "auto_queue" | "rep_review";

export type { EnrichmentInstitution, EnrichmentContact, EnrichmentPipelineFlags };

export interface EnrichmentInput {
  leadId: string;
  campaignId: string | null;
  market: Market;
  seed: {
    name: string | null;
    email: string | null;
    role: string | null;
    companyName: string;
    companyWebsite: string | null;
    companySize?: "small" | "medium" | "large" | "unknown" | null;
    industry: string | null;
    region: string;
  };
}

export interface ProviderResult {
  source: EnrichmentSource;
  institution?: Partial<EnrichmentInstitution>;
  contact?: Partial<EnrichmentContact>;
}

export interface EnrichmentProvider {
  name: EnrichmentSource;
  enrich(input: EnrichmentInput): Promise<ProviderResult | null>;
}

export interface EnrichmentRecord {
  lead_id: string;
  enriched_at: string;
  enrichment_source: EnrichmentSource;
  market: Market;
  institution: EnrichmentInstitution;
  contact: EnrichmentContact;
  pipeline_flags: EnrichmentPipelineFlags;
  routing: EnrichmentRouting;
  routing_reason: string | null;
}
