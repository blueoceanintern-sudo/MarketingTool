import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { promptTemplates } from "../../db/schema";

type TemplateType = "initial" | "followup_1" | "followup_2" | "breakup";

const WORD_LIMIT: Record<TemplateType, number> = {
  initial: 125,
  followup_1: 90,
  followup_2: 85,
  breakup: 70,
};

const ATTEMPT_TO_TYPE: Record<number, TemplateType> = {
  1: "followup_1",
  2: "followup_2",
  3: "breakup",
};

interface LeadContext {
  name?: string;
  role?: string;
  companyName?: string;
  industry?: string;
  companySize?: string;
  location?: string;
}

export interface CampaignContext {
  name?: string;
  description?: string | null;
  painPoints?: string[] | null;
  callToAction?: string | null;
}

export interface ScoreBreakdown {
  painPointFit: number;
  campaignAlignment: number;
  personalisationQuality: number;
  lengthCompliance: number;
}

export interface DraftResult {
  leadId: string;
  campaignId: string;
  templateId: string;
  subject: string;
  body: string;
  confidenceScore: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface FollowUpRequest {
  followUpId: string;
  leadId: string;
  campaignId: string;
  lead: LeadContext;
  campaign: CampaignContext;
  attemptNumber: number;
  originalSubject: string;
  previousAngleTags: string[];
}

export interface FollowUpResult {
  followUpId: string;
  subject: string;
  body: string;
  angleTag: string;
  templateId: string;
  scoreBreakdown: ScoreBreakdown;
}

interface DraftRequest {
  leadId: string;
  campaignId: string;
  lead: LeadContext;
  campaign?: CampaignContext;
}

// ---------------------------------------------------------------------------
// Thompson Sampling — template selection
// ---------------------------------------------------------------------------

const NEGATIVE_RATE_THRESHOLD = 0.05;
const SPAM_RATE_THRESHOLD = 0.01;
const NEGATIVE_FILTER_MIN_SENDS = 30;

function normalSample(): number {
  let u: number;
  do { u = Math.random(); } while (u === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function sampleGamma(shape: number): number {
  if (shape < 1) return sampleGamma(1 + shape) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = normalSample(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x + y === 0 ? 0.5 : x / (x + y);
}

export function thompsonSample<T extends { sendCount: number; positiveIntentCount: number; negativeReplyCount: number; spamComplaintCount: number }>(
  items: T[],
): T | undefined {
  if (items.length === 0) return undefined;

  // Soft-exclude templates with a high negative-reply or spam-complaint rate
  // once they have enough sends to make the signal meaningful.
  // Spam threshold (1%) is tighter than negative replies (5%) — a spam complaint
  // damages SES sender reputation directly.
  const eligible = items.filter(
    (t) =>
      t.sendCount < NEGATIVE_FILTER_MIN_SENDS ||
      (t.negativeReplyCount / t.sendCount < NEGATIVE_RATE_THRESHOLD &&
       t.spamComplaintCount / t.sendCount < SPAM_RATE_THRESHOLD),
  );
  const pool = eligible.length > 0 ? eligible : items;

  // Beta(1,1) = Uniform for unseen templates, so new variants explore naturally
  // without a separate burn-in phase that would freeze proven winners.
  let best: T | undefined;
  let bestSample = -1;
  for (const item of pool) {
    const nonPositive = item.sendCount - item.positiveIntentCount;
    const draw = sampleBeta(item.positiveIntentCount + 1, nonPositive + 1);
    if (draw > bestSample) { bestSample = draw; best = item; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Scoring — separate adversarial call, starts from 0
// ---------------------------------------------------------------------------

const SCORING_SYSTEM_PROMPT = `You are a critical B2B email quality reviewer. Score a cold outreach email honestly and harshly against three criteria.

Start from 0 for each criterion — award points only when clearly earned. Be a strict critic: if in doubt, score low.

## Scoring criteria

painPointFit (0–25)
Score 22–25: the opening pain point is a specific, realistic daily frustration for someone in this exact role at this type of company — not just thematically relevant to the campaign.
Score 15–21: relevant pain point but broad enough to apply to a range of similar roles or industries.
Score 5–14: pain point is thematic to the campaign but generic — it could apply to almost anyone in business.
Score 0–4: pain point is absent, irrelevant to this role, or not grounded in the lead data provided.

campaignAlignment (0–25)
Score 22–25: email clearly advances the campaign's specific objective, every claim is grounded in the product description, no generic filler.
Score 15–21: broadly on-brief but uses generic language or slightly overstates the product.
Score 5–14: email drifts from the campaign objective, or makes claims not clearly supported by the product description.
Score 0–4: email is off-brief, contradicts the campaign objective, or fabricates product capabilities.

personalisationQuality (0–25)
Score 22–25: the email is clearly written for this specific lead — role, industry, and company context are used meaningfully. It would not work for a different lead without significant edits.
Score 15–21: some role-specific language but could be sent to a range of similar roles with minor tweaks.
Score 5–14: personalisation is surface-level — only the name or company name appears.
Score 0–4: no meaningful personalisation — could be sent to anyone.

## Output format
Return only valid JSON — no explanation, no preamble:
{
  "painPointFit": <integer 0-25>,
  "campaignAlignment": <integer 0-25>,
  "personalisationQuality": <integer 0-25>
}`;

function buildScoringUserPrompt(
  email: { subject: string; body: string },
  lead: LeadContext,
  campaign?: CampaignContext,
): string {
  const painPoints = campaign?.painPoints?.map((p) => `  • ${p}`).join("\n") ?? "  • Not specified";
  return `## Lead
- role: ${lead.role ?? "Unknown"}
- industry: ${lead.industry ?? "Unknown"}
- company: ${lead.companyName ?? "Unknown"}
- location: ${lead.location ?? "Unknown"}

## Campaign description
${campaign?.description ?? "Not specified"}

## Campaign pain points
${painPoints}

## Email to score
Subject: ${email.subject}
Body:
${email.body}`;
}

async function scoreEmailsBatch(
  items: { key: string; email: { subject: string; body: string }; lead: LeadContext; campaign?: CampaignContext }[],
  client: Anthropic,
): Promise<Map<string, { painPointFit: number; campaignAlignment: number; personalisationQuality: number }>> {
  const settled = await Promise.allSettled(
    items.map(({ key, email, lead, campaign }) =>
      client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 120,
        system: [{ type: "text" as const, text: SCORING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: buildScoringUserPrompt(email, lead, campaign) }],
      }).then((msg) => ({ key, msg }))
    ),
  );

  const scores = new Map<string, { painPointFit: number; campaignAlignment: number; personalisationQuality: number }>();
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.error(`[scoring] API call failed:`, outcome.reason);
      continue;
    }
    const { key, msg } = outcome.value;
    const text = msg.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    try {
      const match = text.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON in scoring response");
      const parsed = JSON.parse(match[0]) as { painPointFit?: number; campaignAlignment?: number; personalisationQuality?: number };
      scores.set(key, {
        painPointFit: Math.min(25, Math.max(0, Math.round(parsed.painPointFit ?? 0))),
        campaignAlignment: Math.min(25, Math.max(0, Math.round(parsed.campaignAlignment ?? 0))),
        personalisationQuality: Math.min(25, Math.max(0, Math.round(parsed.personalisationQuality ?? 0))),
      });
    } catch (err) {
      console.error(`[scoring] failed to parse score for ${key}:`, err);
    }
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildLeadBlock(lead: LeadContext): string {
  const name = lead.name || "Unknown";
  return `## Lead data
- contact_name: ${name}
- role: ${lead.role ?? "Unknown"}
- company_name: ${lead.companyName ?? "Unknown"}
- industry: ${lead.industry ?? "Unknown"}
- company_size: ${lead.companySize ?? "Unknown"}
- location: ${lead.location ?? "Unknown"}`;
}

function buildPainPoints(painPoints?: string[] | null): string {
  if (!painPoints || painPoints.length === 0) return "  • Not specified";
  return painPoints.map((p) => `  • ${p}`).join("\n");
}

function buildUserPrompt(lead: LeadContext, campaign?: CampaignContext): string {
  return `${buildLeadBlock(lead)}

## What we offer
${campaign?.description ?? "Not specified"}

## Campaign context
- campaign_pain_points:
${buildPainPoints(campaign?.painPoints)}`;
}

function buildFollowUpPrompt(
  lead: LeadContext,
  campaign: CampaignContext,
  originalSubject: string,
  previousAngleTags: string[],
): string {
  return `${buildLeadBlock(lead)}

## Product context
${campaign.description ?? "Not specified"}

## Campaign context
- original_subject: ${originalSubject}
- previous_angle_tags: ${previousAngleTags.length > 0 ? previousAngleTags.join(", ") : "none"}
- campaign_pain_points:
${buildPainPoints(campaign.painPoints)}`;
}

// ---------------------------------------------------------------------------
// Generation response parser — extracts email content only, no scoring
// ---------------------------------------------------------------------------

function parseResponse(raw: string): { subject: string; body: string; angleTag?: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in response");

  const parsed = JSON.parse(match[0]) as { subject?: string; body?: string; angle_tag?: string };

  if (!parsed.subject || !parsed.body) {
    throw new Error("Missing subject or body in draft response");
  }

  return { subject: parsed.subject, body: parsed.body, angleTag: parsed.angle_tag };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateFollowUpBatch(requests: FollowUpRequest[]): Promise<FollowUpResult[]> {
  if (requests.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const neededTypes = [
    ...new Set(requests.map((r) => ATTEMPT_TO_TYPE[r.attemptNumber] ?? "followup_1")),
  ] as TemplateType[];

  const templateRows = await db
    .select({
      id: promptTemplates.id,
      systemPrompt: promptTemplates.systemPrompt,
      templateType: promptTemplates.templateType,
      sendCount: promptTemplates.sendCount,
      positiveIntentCount: promptTemplates.positiveIntentCount,
      negativeReplyCount: promptTemplates.negativeReplyCount,
      spamComplaintCount: promptTemplates.spamComplaintCount,
    })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), inArray(promptTemplates.templateType, neededTypes)));

  const templatesByType = new Map<TemplateType, typeof templateRows>();
  for (const row of templateRows) {
    const type = row.templateType as TemplateType;
    const bucket = templatesByType.get(type) ?? [];
    bucket.push(row);
    templatesByType.set(type, bucket);
  }

  const templateByType = new Map<TemplateType, typeof templateRows[number]>();
  for (const type of neededTypes) {
    const pool = templatesByType.get(type);
    if (!pool || pool.length === 0) throw new Error(`No active prompt template for type: ${type}`);
    const selected = thompsonSample(pool);
    if (!selected) throw new Error(`Thompson sampling failed for type: ${type}`);
    templateByType.set(type, selected);
  }

  const client = new Anthropic({ apiKey });

  const maxTokensByType: Record<TemplateType, number> = {
    initial: 400,
    followup_1: 300,
    followup_2: 300,
    breakup: 256,
  };

  const sorted = [...requests].sort((a, b) => a.attemptNumber - b.attemptNumber);

  const requestTemplateMap = new Map<string, string>();
  const requestTypeMap = new Map<string, TemplateType>();

  const batch = await client.messages.batches.create({
    requests: sorted.map((req) => {
      const type = ATTEMPT_TO_TYPE[req.attemptNumber] ?? "followup_1";
      const tmpl = templateByType.get(type)!;
      const customId = `followup:${req.followUpId}`;
      requestTemplateMap.set(customId, tmpl.id);
      requestTypeMap.set(customId, type);
      return {
        custom_id: customId,
        params: {
          model: "claude-haiku-4-5",
          max_tokens: maxTokensByType[type],
          system: [{ type: "text" as const, text: tmpl.systemPrompt, cache_control: { type: "ephemeral" as const } }],
          messages: [{ role: "user" as const, content: buildFollowUpPrompt(req.lead, req.campaign, req.originalSubject, req.previousAngleTags) }],
        },
      };
    }),
  });

  let status = batch.processing_status;
  while (status !== "ended") {
    await new Promise((r) => setTimeout(r, 5000));
    const updated = await client.messages.batches.retrieve(batch.id);
    status = updated.processing_status;
  }

  // Collect generated emails
  const generated: { customId: string; subject: string; body: string; angleTag: string }[] = [];
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type !== "succeeded") {
      console.error(`Follow-up batch item failed for ${result.custom_id}:`, result.result);
      continue;
    }
    const text = result.result.message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    try {
      const { subject, body, angleTag } = parseResponse(text.text);
      generated.push({ customId: result.custom_id, subject, body, angleTag: angleTag ?? "manual_workload" });
    } catch (err) {
      console.error(`Failed to parse follow-up for ${result.custom_id}:`, err);
    }
  }

  // Score all generated emails in a separate call
  const scoreMap = await scoreEmailsBatch(
    generated.map(({ customId, subject, body }) => {
      const req = requests.find((r) => `followup:${r.followUpId}` === customId)!;
      return { key: customId, email: { subject, body }, lead: req.lead, campaign: req.campaign };
    }),
    client,
  );

  const results: FollowUpResult[] = [];
  for (const { customId, subject, body, angleTag } of generated) {
    const type = requestTypeMap.get(customId) ?? "followup_1";
    const wordCount = body.trim().split(/\s+/).length;
    const lengthCompliance = wordCount <= WORD_LIMIT[type] ? 25 : 0;
    const sub = scoreMap.get(customId) ?? { painPointFit: 0, campaignAlignment: 0, personalisationQuality: 0 };
    results.push({
      followUpId: customId.slice("followup:".length),
      subject,
      body,
      angleTag,
      templateId: requestTemplateMap.get(customId) ?? "",
      scoreBreakdown: { ...sub, lengthCompliance },
    });
  }

  return results;
}

export async function generateDraftsBatch(requests: DraftRequest[]): Promise<DraftResult[]> {
  if (requests.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const allTemplates = await db
    .select({
      id: promptTemplates.id,
      systemPrompt: promptTemplates.systemPrompt,
      sendCount: promptTemplates.sendCount,
      positiveIntentCount: promptTemplates.positiveIntentCount,
      negativeReplyCount: promptTemplates.negativeReplyCount,
      spamComplaintCount: promptTemplates.spamComplaintCount,
    })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), eq(promptTemplates.templateType, "initial")));

  if (allTemplates.length === 0) {
    throw new Error("No active initial prompt template — run db:seed to insert templates");
  }

  const template = thompsonSample(allTemplates);
  if (!template) throw new Error("Thompson sampling returned no template");
  const client = new Anthropic({ apiKey });

  console.log(`[drafting] generating ${requests.length} draft(s)`);

  // Call 1: generate emails
  const genSettled = await Promise.allSettled(
    requests.map((req) =>
      client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: [{ type: "text" as const, text: template.systemPrompt, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: buildUserPrompt(req.lead, req.campaign) }],
      }).then((msg) => ({ req, msg }))
    ),
  );

  const generated: { req: DraftRequest; subject: string; body: string }[] = [];
  for (const outcome of genSettled) {
    if (outcome.status === "rejected") {
      console.error(`[drafting] generation failed:`, outcome.reason);
      continue;
    }
    const { req, msg } = outcome.value;
    const text = msg.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    try {
      const { subject, body } = parseResponse(text.text);
      generated.push({ req, subject, body });
    } catch (err) {
      console.error(`[drafting] failed to parse draft for lead ${outcome.value.req.leadId}:`, err);
    }
  }

  // Call 2: score all generated emails
  const scoreMap = await scoreEmailsBatch(
    generated.map(({ req, subject, body }) => ({
      key: req.leadId,
      email: { subject, body },
      lead: req.lead,
      campaign: req.campaign,
    })),
    client,
  );

  const results: DraftResult[] = [];
  for (const { req, subject, body } of generated) {
    const wordCount = body.trim().split(/\s+/).length;
    const lengthCompliance = wordCount <= WORD_LIMIT.initial ? 25 : 0;
    const sub = scoreMap.get(req.leadId) ?? { painPointFit: 0, campaignAlignment: 0, personalisationQuality: 0 };
    const scoreBreakdown: ScoreBreakdown = { ...sub, lengthCompliance };
    results.push({
      leadId: req.leadId,
      campaignId: req.campaignId,
      templateId: template.id,
      subject,
      body,
      confidenceScore: sub.painPointFit + sub.campaignAlignment + sub.personalisationQuality + lengthCompliance,
      scoreBreakdown,
    });
  }

  console.log(`[drafting] done: ${results.length}/${requests.length} succeeded`);
  return results;
}
