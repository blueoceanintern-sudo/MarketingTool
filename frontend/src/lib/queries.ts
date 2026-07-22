import { queryOptions } from "@tanstack/react-query";
import * as api from "./api";

// ── Query keys (for invalidation prefixes) ──────────────────────────────────
// Mutations invalidate by prefix, e.g. invalidateQueries({ queryKey: keys.campaigns }).
export const keys = {
  campaigns: ["campaigns"] as const,
  campaign: (id: string) => ["campaigns", id] as const,
  leads: ["leads"] as const,
  drafts: ["drafts"] as const,
  replies: ["replies"] as const,
  demos: ["demos"] as const,
  templates: ["templates"] as const,
  registry: ["registry"] as const,
};

// ── Campaigns ───────────────────────────────────────────────────────────────
export const campaignsOptions = () =>
  queryOptions({ queryKey: keys.campaigns, queryFn: () => api.getCampaigns() });

export const campaignOptions = (id: string) =>
  queryOptions({
    queryKey: keys.campaign(id),
    queryFn: async () => {
      const data = await api.getCampaign(id);
      if (data === null) throw new Error("Campaign not found");
      return data;
    },
  });

export const campaignLeadsOptions = (id: string, page: number, limit = 50, status?: string) =>
  queryOptions({
    queryKey: ["campaigns", id, "leads", { page, limit, status }],
    queryFn: () => api.getCampaignLeadsPaginated(id, { page, limit, status }),
  });

export const campaignSuppressionsOptions = (id: string) =>
  queryOptions({
    queryKey: ["campaigns", id, "suppressions"],
    queryFn: () => api.getCampaignSuppressions(id),
  });

// ── Leads ─────────────────────────────────────────────────────────────────--
export type LeadsParams = {
  page: number;
  limit?: number;
  status?: string;
  email_status?: string;
  routing?: string;
  campaign_id?: string;
  search?: string;
};

export const leadsOptions = (params: LeadsParams) =>
  queryOptions({ queryKey: ["leads", params], queryFn: () => api.getLeadsPaginated(params) });

export const leadsSummaryOptions = () =>
  queryOptions({
    queryKey: ["leads", "summary"],
    queryFn: () => api.getLeadsSummary(),
    staleTime: 30_000,
  });

export const leadEnrichmentOptions = (leadId: string) =>
  queryOptions({
    queryKey: ["leads", leadId, "enrichment"],
    queryFn: () => api.getLeadEnrichment(leadId),
  });

// ── Drafts ────────────────────────────────────────────────────────────────--
export const draftQueueOptions = () =>
  queryOptions({ queryKey: ["drafts", "queue"], queryFn: () => api.getDraftQueue() });

export const draftsByStatusOptions = (status: "scheduled" | "sent") =>
  queryOptions({ queryKey: ["drafts", "status", status], queryFn: () => api.getDraftsByStatus(status) });

// ── Replies ───────────────────────────────────────────────────────────────--
export const repliesOptions = (flaggedOnly = false) =>
  queryOptions({ queryKey: ["replies", { flaggedOnly }], queryFn: () => api.getReplies(flaggedOnly) });

export const demosOptions = () =>
  queryOptions({ queryKey: keys.demos, queryFn: () => api.getDemos() });

// ── Templates ─────────────────────────────────────────────────────────────--
export const templatesOptions = () =>
  queryOptions({ queryKey: ["templates", "list"], queryFn: () => api.getPromptTemplates() });

export const templateEngagementOptions = () =>
  queryOptions({ queryKey: ["templates", "engagement"], queryFn: () => api.getTemplateEngagement() });

// ── Registry ──────────────────────────────────────────────────────────────--
export type RegistrySourcesParams = {
  page: number;
  limit?: number;
  geoname_id?: number;
  vertical?: string;
  active?: boolean;
};

export const registrySourcesOptions = (params: RegistrySourcesParams) =>
  queryOptions({
    queryKey: ["registry", "sources", params],
    queryFn: () => api.getRegistrySourcesPaginated(params),
  });

// Scrapeable (vertical, geo) coverage with source counts — drives the leads
// scrape picker.
export const sourceCoverageOptions = () =>
  queryOptions({
    queryKey: ["registry", "source-coverage"],
    queryFn: () => api.getSourceCoverage(),
  });

export const directoryConfigsOptions = () =>
  queryOptions({ queryKey: ["registry", "directory-configs"], queryFn: () => api.getDirectoryConfigs() });

export const activeCombinationsOptions = () =>
  queryOptions({ queryKey: ["registry", "active-combinations"], queryFn: () => api.getActiveCombinations() });

export const taxonomyOptions = () =>
  queryOptions({ queryKey: ["registry", "taxonomy"], queryFn: () => api.getTaxonomy() });
