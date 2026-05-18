const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/api/v1${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── Shared types ──────────────────────────────────────────────────────────────

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
  status: CampaignStatus;
  leads_count: number;
  drafts_pending: number;
  sent: number;
  open_rate: number;
  created_at: string;
}

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  is_verified: boolean;
  status: LeadStatus;
  company_name: string;
  campaign_id?: string;
  campaign_name?: string;
  created_at: string;
}

export interface Draft {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_role: string;
  campaign_id: string;
  campaign_name: string;
  persona: "technical" | "executive" | "ops";
  subject: string;
  body: string;
  confidence_score: number;
  status: DraftStatus;
  created_at: string;
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

// ── API functions ─────────────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  return (await apiFetch<Campaign[]>("/campaigns")) ?? [];
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return apiFetch<Campaign>(`/campaigns/${id}`);
}

export async function getLeads(campaignId?: string): Promise<Lead[]> {
  const path = campaignId ? `/campaigns/${campaignId}/leads` : "/leads";
  return (await apiFetch<Lead[]>(path)) ?? [];
}

export async function getDraftQueue(): Promise<Draft[]> {
  return (await apiFetch<Draft[]>("/drafts/queue")) ?? [];
}

export async function getReplies(flaggedOnly = false): Promise<Reply[]> {
  const path = flaggedOnly ? "/replies/flagged" : "/replies";
  return (await apiFetch<Reply[]>(path)) ?? [];
}

export async function getDemos(): Promise<Demo[]> {
  return (await apiFetch<Demo[]>("/demos")) ?? [];
}

export async function getAnalyticsOverview(): Promise<AnalyticsOverview | null> {
  return apiFetch<AnalyticsOverview>("/analytics/overview");
}

export async function approveDraft(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/v1/drafts/${id}/approve`, { method: "PATCH" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function rejectDraft(id: string, reason: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/v1/drafts/${id}/reject`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function editDraft(id: string, updates: { subject?: string; body?: string }): Promise<Draft | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/drafts/${id}/edit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function bookDemo(payload: {
  lead_id: string;
  campaign_id: string;
  reply_id: string;
  assigned_to: string;
}): Promise<Demo | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/demos`, {
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
    const res = await fetch(`${BASE}/api/v1/replies/${id}/resolve`, { method: "PATCH" });
    return res.ok;
  } catch {
    return false;
  }
}
