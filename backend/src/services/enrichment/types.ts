import type {
  EnrichmentInstitution,
  EnrichmentContact,
  EnrichmentPipelineFlags,
} from "../../db/schema/tables";

export type Market = "SG" | "AU" | "US";
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
