import { eq } from "drizzle-orm";
import { db } from "../../db";
import { leads, companies, campaigns, campaignLeads, campaignLeadExclusions } from "../../db/schema";
import { normalizeVertical } from "../../db/schema/tables";
import { type AssignerConfig, defaultConfig } from "./config";

export interface AssignmentResult {
  leadId: string;
  assigned: { campaignId: string; reason: string }[];
  usedFallback: boolean;
  skipped: boolean;
  skippedReason?: string;
}

type Campaign = typeof campaigns.$inferSelect;

// Returns the canonical geo code (e.g. "SG") if the location string matches
// any alias, or null if unresolved.
function resolveGeo(location: string, aliases: Record<string, string[]>): string | null {
  const lower = location.toLowerCase();
  for (const [canonical, terms] of Object.entries(aliases)) {
    if (terms.some((t) => lower.includes(t))) return canonical;
  }
  return null;
}

// Returns the canonical vertical (e.g. "education") if the industry string
// matches any alias; falls back to normalizeVertical(industry) for direct
// equality comparisons when no alias matches.
function resolveVertical(industry: string | null, aliases: Record<string, string[]>): string | null {
  if (!industry) return null;
  const lower = industry.toLowerCase();
  for (const [canonical, terms] of Object.entries(aliases)) {
    if (terms.some((t) => lower.includes(t))) return canonical;
  }
  return normalizeVertical(industry);
}

// Stage 2: fraction of meaningful role tokens found in campaign text fields.
function scoreRole(role: string, campaign: Campaign): number {
  const tokens = role.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  if (tokens.length === 0) return 0;
  const haystack = [
    ...(campaign.painPoints ?? []),
    campaign.description ?? "",
    campaign.callToAction ?? "",
  ].join(" ").toLowerCase();
  return tokens.filter((t) => haystack.includes(t)).length / tokens.length;
}

// Stage 3: 1 for exact size match, 0 otherwise.
function scoreSize(companySize: string, campaign: Campaign): number {
  return campaign.companySizeTarget === companySize ? 1 : 0;
}

export async function assignLeadToCampaigns(
  leadId: string,
  config: AssignerConfig = defaultConfig,
): Promise<AssignmentResult> {
  const [row] = await db
    .select({
      id: leads.id,
      role: leads.role,
      companyLocation: companies.location,
      companyIndustry: companies.industry,
      companySize: companies.companySize,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!row) {
    return { leadId, assigned: [], usedFallback: false, skipped: true, skippedReason: "lead not found" };
  }

  const activeCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.status, "active"));

  if (activeCampaigns.length === 0) {
    return { leadId, assigned: [], usedFallback: false, skipped: true, skippedReason: "no active campaigns" };
  }

  const [existingRows, exclusionRows] = await Promise.all([
    db.select({ campaignId: campaignLeads.campaignId }).from(campaignLeads).where(eq(campaignLeads.leadId, leadId)),
    db.select({ campaignId: campaignLeadExclusions.campaignId }).from(campaignLeadExclusions).where(eq(campaignLeadExclusions.leadId, leadId)),
  ]);
  const existingIds = new Set(existingRows.map((r) => r.campaignId));
  const excludedIds = new Set(exclusionRows.map((r) => r.campaignId));
  const isEligible = (c: Campaign) => !existingIds.has(c.id) && !excludedIds.has(c.id);

  // ── Stage 0/1: geo + vertical ─────────────────────────────────────────────
  const leadGeo = resolveGeo(row.companyLocation, config.geoAliases);
  const leadVertical = resolveVertical(row.companyIndustry, config.verticalAliases);

  let candidates = activeCampaigns.filter((c) => {
    if (!isEligible(c)) return false;
    const geoMatch = leadGeo !== null && c.geography === leadGeo;
    const verticalMatch =
      leadVertical !== null &&
      normalizeVertical(c.vertical) === normalizeVertical(leadVertical);
    return geoMatch && verticalMatch;
  });

  let usedFallback = false;

  if (candidates.length === 0) {
    if (config.defaultCampaignId) {
      const fallback = activeCampaigns.find(
        (c) => c.id === config.defaultCampaignId && isEligible(c),
      );
      if (fallback) {
        candidates = [fallback];
        usedFallback = true;
      }
    }
    if (candidates.length === 0) {
      return {
        leadId,
        assigned: [],
        usedFallback: false,
        skipped: true,
        skippedReason: `no geo+vertical match (geo=${leadGeo ?? "unresolved"}, vertical=${leadVertical ?? "unresolved"}) and no default campaign`,
      };
    }
  }

  // ── Stages 2+3: scoring (dormant while role/size are empty) ───────────────
  const hasRole = !!row.role;
  const hasSize = !!row.companySize;
  const scoringActive = !usedFallback && (hasRole || hasSize);

  let selected: { campaign: Campaign; reason: string }[];

  if (scoringActive) {
    const scored = candidates.map((c) => {
      let score = 0;
      const parts = [`geo:${leadGeo}`, `vertical:${leadVertical}`];

      if (hasRole) {
        const rs = scoreRole(row.role!, c);
        score += rs * config.roleScoreWeight;
        if (rs > 0) parts.push(`role:${rs.toFixed(2)}`);
      }

      if (hasSize) {
        const ss = scoreSize(row.companySize!, c);
        score += ss * config.sizeScoreWeight;
        if (ss > 0) parts.push("size:match");
      }

      return { campaign: c, score, reason: parts.join("+") };
    });

    selected = scored
      .filter((s) => s.score >= config.roleScoreThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.topN);
  } else {
    const suffix = usedFallback ? "+fallback" : "";
    selected = candidates.map((c) => ({
      campaign: c,
      reason: `geo:${leadGeo ?? "unknown"}+vertical:${leadVertical ?? "unknown"}${suffix}`,
    }));
  }

  if (selected.length === 0) {
    return {
      leadId,
      assigned: [],
      usedFallback,
      skipped: true,
      skippedReason: "no candidates passed scoring threshold",
    };
  }

  await db
    .insert(campaignLeads)
    .values(selected.map((s) => ({ leadId, campaignId: s.campaign.id, source: s.reason })))
    .onConflictDoNothing();

  return {
    leadId,
    assigned: selected.map((s) => ({ campaignId: s.campaign.id, reason: s.reason })),
    usedFallback,
    skipped: false,
  };
}

export async function assignBatch(
  leadIds: string[],
  config?: AssignerConfig,
): Promise<AssignmentResult[]> {
  return Promise.all(leadIds.map((id) => assignLeadToCampaigns(id, config)));
}
