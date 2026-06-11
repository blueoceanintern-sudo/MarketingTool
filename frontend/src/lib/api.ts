const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Set by TokenSync in Providers once the Auth.js session is available.
let _token: string | undefined;
export function setApiToken(token: string) {
  _token = token;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
  };
}

// Unified fetch wrapper — all API calls go through here so auth is applied consistently.
function apiRequest(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: authHeaders(init?.headers as Record<string, string> | undefined),
  });
}

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await apiRequest(`${BASE}/api/v1${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface LeadsSummary {
  auto_queue: number;
  rep_review: number;
  pending: number;
}

export type PaginatedLeads = Paginated<Lead> & { summary: LeadsSummary };

export type CampaignStatus = "draft" | "active" | "paused" | "complete";
export type LeadStatus = "new" | "contacted" | "replied" | "converted" | "suppressed";
export type DraftStatus = "pending_review" | "approved" | "rejected" | "scheduled" | "sent";
export type Sentiment = "positive" | "negative" | "neutral";
export type DemoStatus = "pending" | "scheduled" | "completed" | "cancelled";

export interface Campaign {
  id: string;
  name: string;
  vertical: string;
  geography: string[];
  company_size_target: string;
  status: CampaignStatus;
  description: string | null;
  pain_points: string[];
  call_to_action: string | null;
  leads_count: number;
  drafts_pending: number;
  sent: number;
  open_rate: number;
  created_at: string;
}

export type EmailStatus = "verified" | "pattern_guessed" | "not_found";
export type EnrichmentSource = "registry" | "cowork_claude" | "snovio" | "manual";
export type EnrichmentRouting = "auto_queue" | "rep_review";

export interface Lead {
  id: string;
  name: string;
  email: string;
  role: string;
  is_verified: boolean;
  email_status: EmailStatus | null;
  enrichment_source: EnrichmentSource | null;
  routing: EnrichmentRouting | null;
  enriched_at: string | null;
  scraper_used: ScraperType | null;
  status: LeadStatus;
  company_name: string;
  company_source: string | null;
  campaigns: { id: string; name: string; status: LeadStatus }[];
  created_at: string;
}

export interface EnrichmentRecord {
  lead_id: string;
  enriched_at: string;
  enrichment_source: EnrichmentSource;
  market: "SG" | "AU" | "US";
  institution: {
    name: string;
    type: string;
    registration_id: string | null;
    size: "small" | "medium" | "large" | "unknown";
    website: string | null;
    region: string;
  };
  contact: {
    full_name: string | null;
    first_name: string | null;
    role: string | null;
    email: string | null;
    email_status: EmailStatus;
  };
  pipeline_flags: {
    is_duplicate: boolean;
    missing_critical_fields: boolean;
    missing_fields_detail: string[];
    risk_flag: boolean;
    risk_flag_reason: string | null;
  };
  routing: EnrichmentRouting;
  routing_reason: string | null;
}

export interface ScoreBreakdown {
  painPointFit: number;
  campaignAlignment: number;
  personalisationQuality: number;
  lengthCompliance: number;
}

export interface Draft {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_role: string;
  campaign_id: string;
  campaign_name: string;
  template_id: string;
  subject: string;
  body: string;
  confidence_score: number;
  score_breakdown: ScoreBreakdown | null;
  status: DraftStatus;
  created_at: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  weight: number;
  active: boolean;
  parent_template_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateEngagement {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  active: boolean;
  created_by: string;
  parent_template_id: string | null;
  sent: number;
  opened: number;
  replied: number;
  open_rate: number;
  reply_rate: number;
}

export interface Reply {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_email: string;
  lead_company: string;
  campaign_id: string;
  campaign_name: string;
  body: string;
  sentiment: Sentiment;
  category: string;
  received_at: string;
  is_flagged: boolean;
}

export interface Demo {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_company: string;
  campaign_id: string;
  assigned_to: string;
  status: DemoStatus;
  created_at: string;
}

export interface AnalyticsOverview {
  total_leads_contacted: number;
  total_sent: number;
  total_opened: number;
  total_replied: number;
  total_demos: number;
  pending_review: number;
  total_suppressions: number;
  open_rate: number;
  reply_rate: number;
}

export type ScraperType = "crawl4ai" | "cheerio" | "api";

export interface SourceRegistry {
  id: string;
  name: string;
  vertical: string;
  geo: string;
  url: string;
  scraper_type: ScraperType;
  legal_flag: boolean;
  selectors: Record<string, string> | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  return (await apiFetch<Campaign[]>("/campaigns")) ?? [];
}

export type DiscoveryStatus =
  | { status: "already_seeded"; message: string }
  | { status: "triggered"; message: string; domains: string[] }
  | { status: "skipped_no_config"; message: string };

export async function createCampaign(payload: {
  name: string;
  vertical: string;
  geography: string[];
  company_size_target: string;
  status?: CampaignStatus;
  description?: string | null;
  pain_points?: string[];
  call_to_action?: string | null;
}): Promise<{ campaign: Campaign | null; discovery?: DiscoveryStatus; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { campaign: null, error: body.error ?? `Request failed (${res.status})` };
    }
    const data = (await res.json()) as Campaign & { discovery?: DiscoveryStatus };
    const { discovery, ...campaign } = data;
    return { campaign: campaign as Campaign, discovery };
  } catch {
    return { campaign: null, error: "Could not reach the API. Is the backend running?" };
  }
}

export async function triggerCampaignScrape(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/campaigns/${campaignId}/scrape`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Scrape failed (${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function triggerCampaignFetchLeads(campaignId: string): Promise<{ ok: boolean; added?: number; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/campaigns/${campaignId}/fetch-leads`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Fetch leads failed (${res.status})` };
    }
    const body = (await res.json()) as { added: number };
    return { ok: true, added: body.added };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function triggerCampaignEnrich(campaignId: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/campaigns/${campaignId}/enrich`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Enrichment failed (${res.status})` };
    }
    const body = (await res.json()) as { count: number };
    return { ok: true, count: body.count };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function triggerCampaignDraftGeneration(
  campaignId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/campaigns/${campaignId}/drafts/generate`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Draft generation failed (${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function updateCampaign(
  campaignId: string,
  payload: {
    name?: string;
    vertical?: string;
    geography?: string[];
    company_size_target?: string;
    description?: string | null;
    pain_points?: string[] | null;
    call_to_action?: string | null;
  },
): Promise<{ campaign: Campaign | null; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { campaign: null, error: body.error ?? `Update failed (${res.status})` };
    }
    const campaign = (await res.json()) as Campaign;
    return { campaign };
  } catch {
    return { campaign: null, error: "Could not reach the API." };
  }
}

export async function updateCampaignStatus(
  campaignId: string,
  status: CampaignStatus
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/campaigns/${campaignId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Update failed (${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return apiFetch<Campaign>(`/campaigns/${id}`);
}

export async function getLeads(campaignId?: string): Promise<Lead[]> {
  if (campaignId) {
    const result = await apiFetch<Paginated<Lead>>(`/campaigns/${campaignId}/leads?limit=500`);
    return result?.data ?? [];
  }
  const result = await apiFetch<PaginatedLeads>(`/leads?limit=500`);
  return result?.data ?? [];
}

export async function getLeadsPaginated(params?: {
  page?: number;
  limit?: number;
  status?: string;
  email_status?: string;
  routing?: string;
  campaign_id?: string;
  search?: string;
}): Promise<PaginatedLeads> {
  const q = new URLSearchParams();
  if (params?.page && params.page > 1) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.status) q.set("status", params.status);
  if (params?.email_status) q.set("email_status", params.email_status);
  if (params?.routing) q.set("routing", params.routing);
  if (params?.campaign_id) q.set("campaign_id", params.campaign_id);
  if (params?.search) q.set("search", params.search);
  const qs = q.toString();
  const result = await apiFetch<PaginatedLeads>(`/leads${qs ? `?${qs}` : ""}`);
  return result ?? { data: [], total: 0, page: 1, limit: 50, total_pages: 0, summary: { auto_queue: 0, rep_review: 0, pending: 0 } };
}

export async function getCampaignLeadsPaginated(
  campaignId: string,
  params?: { page?: number; limit?: number },
): Promise<Paginated<Lead>> {
  const q = new URLSearchParams();
  if (params?.page && params.page > 1) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  const result = await apiFetch<Paginated<Lead>>(`/campaigns/${campaignId}/leads${qs ? `?${qs}` : ""}`);
  return result ?? { data: [], total: 0, page: 1, limit: 50, total_pages: 0 };
}

export async function getLeadEnrichment(leadId: string): Promise<EnrichmentRecord | null> {
  return apiFetch<EnrichmentRecord>(`/leads/${leadId}/enrichment`);
}

export async function addLeadToCampaign(
  leadId: string,
  campaignId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/leads/${leadId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? `Add failed (${res.status})` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function removeLeadFromCampaign(
  leadId: string,
  campaignId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string; cascaded_pending_drafts?: number; cascaded_unsent_follow_ups?: number }> {
  try {
    const url = new URL(`${BASE}/api/v1/leads/${leadId}/campaigns/${campaignId}`);
    if (reason) url.searchParams.set("reason", reason);
    const res = await apiRequest(url.toString(), {
      method: "DELETE",
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      cascaded_pending_drafts?: number;
      cascaded_unsent_follow_ups?: number;
    };
    if (!res.ok) return { ok: false, error: body.error ?? `Remove failed (${res.status})` };
    return {
      ok: true,
      cascaded_pending_drafts: body.cascaded_pending_drafts,
      cascaded_unsent_follow_ups: body.cascaded_unsent_follow_ups,
    };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function getPromptTemplates(): Promise<PromptTemplate[]> {
  return (await apiFetch<PromptTemplate[]>("/templates")) ?? [];
}

export async function createPromptTemplate(payload: {
  name: string;
  description?: string | null;
  system_prompt: string;
  weight?: number;
  active?: boolean;
  parent_template_id?: string | null;
}): Promise<{ template: PromptTemplate | null; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { template: null, error: body.error ?? `Create failed (${res.status})` };
    }
    return { template: (await res.json()) as PromptTemplate };
  } catch {
    return { template: null, error: "Could not reach the API." };
  }
}

export async function updatePromptTemplate(
  id: string,
  payload: { name?: string; description?: string | null; weight?: number; active?: boolean },
): Promise<{ template: PromptTemplate | null; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { template: null, error: body.error ?? `Update failed (${res.status})` };
    }
    return { template: (await res.json()) as PromptTemplate };
  } catch {
    return { template: null, error: "Could not reach the API." };
  }
}

export async function deletePromptTemplate(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/templates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Delete failed (${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function getTemplateEngagement(): Promise<TemplateEngagement[]> {
  return (await apiFetch<TemplateEngagement[]>("/analytics/templates")) ?? [];
}

export async function getDraftQueue(): Promise<Draft[]> {
  return (await apiFetch<Draft[]>("/drafts/queue")) ?? [];
}

export async function getDraftsByStatus(status: "scheduled" | "sent"): Promise<Draft[]> {
  const result = await apiFetch<Paginated<Draft>>(`/drafts?status=${status}&limit=200`);
  return result?.data ?? [];
}

export async function getDraftsByStatusPaginated(
  status: "scheduled" | "sent",
  params?: { page?: number; limit?: number },
): Promise<Paginated<Draft>> {
  const q = new URLSearchParams({ status });
  if (params?.page && params.page > 1) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  const result = await apiFetch<Paginated<Draft>>(`/drafts?${q.toString()}`);
  return result ?? { data: [], total: 0, page: 1, limit: 50, total_pages: 0 };
}

export async function getReplies(flaggedOnly = false): Promise<Reply[]> {
  const path = flaggedOnly ? "/replies/flagged" : "/replies";
  const result = await apiFetch<Paginated<Reply>>(`${path}?limit=200`);
  return result?.data ?? [];
}

export async function getRepliesPaginated(
  flaggedOnly = false,
  params?: { page?: number; limit?: number },
): Promise<Paginated<Reply>> {
  const q = new URLSearchParams();
  if (params?.page && params.page > 1) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  const path = flaggedOnly ? "/replies/flagged" : "/replies";
  const result = await apiFetch<Paginated<Reply>>(`${path}${qs ? `?${qs}` : ""}`);
  return result ?? { data: [], total: 0, page: 1, limit: 50, total_pages: 0 };
}

export async function getDemos(): Promise<Demo[]> {
  return (await apiFetch<Demo[]>("/demos")) ?? [];
}

export interface PaginatedSources extends Paginated<SourceRegistry> {
  summary: { total: number; active: number };
  facets: { geos: string[]; verticals: string[] };
}

const EMPTY_SOURCES: PaginatedSources = {
  data: [],
  total: 0,
  page: 1,
  limit: 25,
  total_pages: 0,
  summary: { total: 0, active: 0 },
  facets: { geos: [], verticals: [] },
};

export async function getRegistrySourcesPaginated(params?: {
  page?: number;
  limit?: number;
  geo?: string;
  vertical?: string;
  active?: boolean;
}): Promise<PaginatedSources> {
  const q = new URLSearchParams();
  if (params?.page && params.page > 1) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.geo) q.set("geo", params.geo);
  if (params?.vertical) q.set("vertical", params.vertical);
  if (params?.active) q.set("active", "true");
  const qs = q.toString();
  const result = await apiFetch<PaginatedSources>(`/registry/sources${qs ? `?${qs}` : ""}`);
  return result ?? EMPTY_SOURCES;
}

export interface DirectoryConfig {
  id: string;
  vertical: string;
  geo: string;
  query: string;
  domains: string[];
}

export interface ActiveCombination {
  vertical: string;
  geo: string;
  has_config: boolean;
}

export async function getDirectoryConfigs(): Promise<DirectoryConfig[]> {
  return (await apiFetch<DirectoryConfig[]>("/registry/directory-configs")) ?? [];
}

export async function getActiveCombinations(): Promise<ActiveCombination[]> {
  return (await apiFetch<ActiveCombination[]>("/registry/active-combinations")) ?? [];
}

export async function triggerDiscovery(
  vertical: string,
  geo: string,
): Promise<{ ok: boolean; status?: string; message?: string; domains?: string[]; error?: string; retryAfter?: number }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/registry/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vertical, geo }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      domains?: string[];
      error?: string;
      retry_after_seconds?: number;
    };
    if (!res.ok) {
      return { ok: false, error: body.error ?? `Request failed (${res.status})`, retryAfter: body.retry_after_seconds };
    }
    return { ok: true, status: body.status, message: body.message, domains: body.domains };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function createRegistrySource(payload: {
  name: string;
  vertical: string;
  geo: string;
  url: string;
  scraper_type: ScraperType;
  legal_flag?: boolean;
  selectors?: Record<string, string>;
  active?: boolean;
}): Promise<{ source: SourceRegistry | null; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/registry/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { source: null, error: body.error ?? `Request failed (${res.status})` };
    }
    const source = (await res.json()) as SourceRegistry;
    return { source };
  } catch {
    return { source: null, error: "Could not reach the API." };
  }
}

export interface RegistryImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export async function importRegistrySources(file: File): Promise<{ result: RegistryImportResult | null; error?: string }> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await apiRequest(`${BASE}/api/v1/registry/sources/import`, { method: "POST", body: form });
    const body = (await res.json()) as RegistryImportResult & { error?: string };
    if (!res.ok) return { result: null, error: body.error ?? `Import failed (${res.status})` };
    return { result: body };
  } catch {
    return { result: null, error: "Could not reach the API." };
  }
}

export async function createDirectoryConfig(payload: {
  vertical: string;
  geo: string;
  query: string;
  domains: string[];
}): Promise<{ config: DirectoryConfig | null; error?: string; isDuplicate?: boolean }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/registry/directory-configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as DirectoryConfig & { error?: string };
    if (res.status === 409) return { config: null, error: body.error ?? "Already exists", isDuplicate: true };
    if (!res.ok) return { config: null, error: body.error ?? `Request failed (${res.status})` };
    return { config: body };
  } catch {
    return { config: null, error: "Could not reach the API." };
  }
}

export async function updateDirectoryConfig(
  id: string,
  payload: { query?: string; domains?: string[] },
): Promise<{ config: DirectoryConfig | null; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/registry/directory-configs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as DirectoryConfig & { error?: string };
    if (!res.ok) return { config: null, error: body.error ?? `Request failed (${res.status})` };
    return { config: body };
  } catch {
    return { config: null, error: "Could not reach the API." };
  }
}

export async function deleteDirectoryConfig(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/registry/directory-configs/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Request failed (${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
}

export async function getAnalyticsOverview(): Promise<AnalyticsOverview | null> {
  return apiFetch<AnalyticsOverview>("/analytics/overview");
}

export interface DailySend {
  date: string;
  count: number;
}

export async function getDailySends(days: number): Promise<DailySend[]> {
  const result = await apiFetch<{ data: DailySend[] }>(`/analytics/daily-sends?days=${days}`);
  return result?.data ?? [];
}

export async function approveDraft(id: string): Promise<boolean> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/drafts/${id}/approve`, { method: "PATCH" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function rejectDraft(id: string, reason: string): Promise<boolean> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/drafts/${id}/reject`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function editDraft(
  id: string,
  updates: { subject?: string; body?: string }
): Promise<{ draft: Draft | null; error?: string }> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/drafts/${id}/edit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { draft: null, error: body.error ?? `Save failed (${res.status})` };
    }
    const draft = (await res.json()) as Draft;
    return { draft };
  } catch {
    return { draft: null, error: "Could not reach the API." };
  }
}

export async function bookDemo(payload: {
  lead_id: string;
  campaign_id: string;
  reply_id: string;
  assigned_to: string;
}): Promise<Demo | null> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/demos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function resolveReply(id: string): Promise<boolean> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/replies/${id}/resolve`, { method: "PATCH" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function triggerEnrichment(): Promise<{ queued: number } | null> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/leads/enrich`, { method: "POST" });
    if (!res.ok) return null;
    return res.json() as Promise<{ queued: number }>;
  } catch {
    return null;
  }
}

export interface SourceCoverage {
  vertical: string;
  geo: string;
  source_count: number;
}

// Distinct (vertical, geo) pairs that have active registry sources, with counts.
// Drives the leads-page scrape picker.
export async function getSourceCoverage(): Promise<SourceCoverage[]> {
  return (await apiFetch<SourceCoverage[]>("/registry/source-coverage")) ?? [];
}

export async function scrapeLeads(params: {
  combos?: { vertical: string; geo: string }[];
  urls?: string[];
  scraper_type?: "cheerio" | "crawl4ai";
}): Promise<{ queued: number } | null> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/leads/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ queued: number }>;
  } catch {
    return null;
  }
}

export async function scrapeRegistrySource(sourceId: string): Promise<{ status: string; source_name: string } | null> {
  try {
    const res = await apiRequest(`${BASE}/api/v1/admin/registry/sources/${sourceId}/scrape`, { method: "POST" });
    if (!res.ok) return null;
    return res.json() as Promise<{ status: string; source_name: string }>;
  } catch {
    return null;
  }
}
