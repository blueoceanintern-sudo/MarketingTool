import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { promptTemplates } from "../../db/schema";

type TemplateType = "initial" | "followup_1" | "followup_2" | "breakup";

// Word limit per template type — mirrors the per-template length rules in seed.sql.
const WORD_LIMIT: Record<TemplateType, number> = {
  initial: 125,
  followup_1: 90,
  followup_2: 85,
  breakup: 70,
};

function confidenceScoreRubric(): string {
  return `
## Confidence score
Return a confidenceScore object with exactly these three integer fields, each scored 0–25:
- painPointFit: the selected pain point is a realistic daily concern for someone in this specific role and industry — not just generically relevant to the campaign. Score low if the pain point could apply to any role or industry.
- campaignAlignment: the draft follows the assigned campaign's objective and stays grounded in the product description. Generic language or off-brief framing scores low.
- personalisationQuality: the email uses the lead's role, industry, and company context meaningfully. Vague or role-agnostic content scores low.
Do not include a lengthCompliance field — that is calculated separately.`;
}

const ATTEMPT_TO_TYPE: Record<number, TemplateType> = {
  1: "followup_1",
  2: "followup_2",
  3: "breakup",
};

interface LeadContext {
  firstName?: string;
  lastName?: string;
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

export interface DraftResult {
  leadId: string;
  campaignId: string;
  templateId: string;
  subject: string;
  body: string;
  confidenceScore: number;
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
}

interface DraftRequest {
  leadId: string;
  campaignId: string;
  lead: LeadContext;
  campaign?: CampaignContext;
}

const NEGATIVE_RATE_THRESHOLD = 0.05;
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

function thompsonSample<T extends { sendCount: number; positiveIntentCount: number; negativeReplyCount: number }>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;

  // Soft exclusion: filter out templates with a high negative-reply rate once
  // they have enough sends to make the signal meaningful.
  const eligible = items.filter((t) =>
    t.sendCount < NEGATIVE_FILTER_MIN_SENDS ||
    t.negativeReplyCount / t.sendCount < NEGATIVE_RATE_THRESHOLD,
  );
  const pool = eligible.length > 0 ? eligible : items;

  // Thompson Sampling for all templates. New templates (sendCount=0) start with
  // Beta(1,1) — a uniform distribution — so they compete naturally with high
  // uncertainty and get explored without starving proven performers.
  let best: T | undefined;
  let bestSample = -1;
  for (const item of pool) {
    const nonPositive = item.sendCount - item.positiveIntentCount;
    const draw = sampleBeta(item.positiveIntentCount + 1, nonPositive + 1);
    if (draw > bestSample) { bestSample = draw; best = item; }
  }
  return best;
}

function buildLeadBlock(lead: LeadContext): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
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

function parseResponse(raw: string, wordLimit: number): {
  subject: string;
  body: string;
  confidenceScore: number;
  angleTag?: string;
} {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in response");

  const parsed = JSON.parse(match[0]) as {
    subject?: string;
    body?: string;
    confidenceScore?: { painPointFit?: number; campaignAlignment?: number; personalisationQuality?: number };
    angle_tag?: string;
  };

  if (!parsed.subject || !parsed.body || !parsed.confidenceScore) {
    throw new Error("Missing required fields in draft response");
  }

  const sub = parsed.confidenceScore;
  const painPointFit = Math.min(25, Math.max(0, Math.round(sub.painPointFit ?? 0)));
  const campaignAlignment = Math.min(25, Math.max(0, Math.round(sub.campaignAlignment ?? 0)));
  const personalisationQuality = Math.min(25, Math.max(0, Math.round(sub.personalisationQuality ?? 0)));
  const wordCount = parsed.body.trim().split(/\s+/).length;
  const lengthCompliance = wordCount <= wordLimit ? 25 : 0;

  return {
    subject: parsed.subject,
    body: parsed.body,
    confidenceScore: painPointFit + campaignAlignment + personalisationQuality + lengthCompliance,
    angleTag: parsed.angle_tag,
  };
}

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
    })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), inArray(promptTemplates.templateType, neededTypes)));

  const templateByType = new Map<TemplateType, typeof templateRows[number]>();
  for (const row of templateRows) {
    const type = row.templateType as TemplateType;
    if (!templateByType.has(type)) templateByType.set(type, row);
  }

  for (const type of neededTypes) {
    if (!templateByType.has(type)) throw new Error(`No active prompt template for type: ${type}`);
  }

  const client = new Anthropic({ apiKey });

  const maxTokensByType: Record<TemplateType, number> = {
    initial: 400,
    followup_1: 300,
    followup_2: 300,
    breakup: 256,
  };

  // Sort by attempt number so same-type requests are adjacent — maximises cache hits.
  const sorted = [...requests].sort((a, b) => a.attemptNumber - b.attemptNumber);

  // Map custom_id → templateId / type so results can carry attribution and word limit back to the caller.
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
          system: [{ type: "text" as const, text: tmpl.systemPrompt + confidenceScoreRubric(), cache_control: { type: "ephemeral" as const } }],
          messages: [
            {
              role: "user" as const,
              content: buildFollowUpPrompt(req.lead, req.campaign, req.originalSubject, req.previousAngleTags),
            },
          ],
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

  const results: FollowUpResult[] = [];
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type !== "succeeded") {
      console.error(`Follow-up batch item failed for ${result.custom_id}:`, result.result);
      continue;
    }
    const text = result.result.message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    try {
      const type = requestTypeMap.get(result.custom_id) ?? "followup_1";
      const { subject, body, angleTag } = parseResponse(text.text, WORD_LIMIT[type]);
      results.push({
        followUpId: result.custom_id.slice("followup:".length),
        subject,
        body,
        angleTag: angleTag ?? "manual_workload",
        templateId: requestTemplateMap.get(result.custom_id) ?? "",
      });
    } catch (err) {
      console.error(`Failed to parse follow-up for ${result.custom_id}:`, err);
    }
  }

  return results;
}

export async function generateDraftsBatch(requests: DraftRequest[]): Promise<DraftResult[]> {
  if (requests.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const allTemplates = await db
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), eq(promptTemplates.templateType, "initial")))
    .limit(1);

  if (allTemplates.length === 0) {
    throw new Error("No active initial prompt template — run db:seed to insert templates");
  }

  const template = allTemplates[0]!;

  const client = new Anthropic({ apiKey });

  console.log(`[drafting] generating ${requests.length} draft(s) (sync)`);

  const settled = await Promise.allSettled(
    requests.map((req) =>
      client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: [{ type: "text" as const, text: template.systemPrompt + confidenceScoreRubric(), cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: buildUserPrompt(req.lead, req.campaign) }],
      }).then((msg) => ({ req, msg }))
    ),
  );

  const results: DraftResult[] = [];

  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.error(`[drafting] API call failed:`, outcome.reason);
      continue;
    }

    const { req, msg } = outcome.value;
    const text = msg.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;

    try {
      const { subject, body, confidenceScore } = parseResponse(text.text, WORD_LIMIT.initial);
      results.push({ leadId: req.leadId, campaignId: req.campaignId, templateId: template.id, subject, body, confidenceScore });
    } catch (err) {
      console.error(`[drafting] failed to parse draft for lead ${req.leadId}:`, err);
    }
  }

  console.log(`[drafting] done: ${results.length}/${requests.length} succeeded`);
  return results;
}
