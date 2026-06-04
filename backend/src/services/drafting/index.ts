import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { promptTemplates } from "../../db/schema";

type TemplateType = "initial" | "followup_1" | "followup_2" | "breakup";

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

function parseResponse(raw: string): {
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
    confidenceScore?: number;
    angle_tag?: string;
  };

  if (!parsed.subject || !parsed.body || parsed.confidenceScore === undefined) {
    throw new Error("Missing required fields in draft response");
  }

  const wordCount = parsed.body.trim().split(/\s+/).length;
  const score = wordCount > 125 ? Math.max(0, parsed.confidenceScore - 20) : parsed.confidenceScore;

  return {
    subject: parsed.subject,
    body: parsed.body,
    confidenceScore: score,
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
      sendCount: promptTemplates.sendCount,
      positiveIntentCount: promptTemplates.positiveIntentCount,
      negativeReplyCount: promptTemplates.negativeReplyCount,
    })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), inArray(promptTemplates.templateType, neededTypes)));

  const templatesByType = new Map<TemplateType, typeof templateRows>();
  for (const row of templateRows) {
    const key = row.templateType as TemplateType;
    if (!templatesByType.has(key)) templatesByType.set(key, []);
    templatesByType.get(key)!.push(row);
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

  // Sort by attempt number so same-type requests are adjacent — maximises cache hits.
  const sorted = [...requests].sort((a, b) => a.attemptNumber - b.attemptNumber);

  // Map custom_id → templateId so results can carry attribution back to the caller.
  const requestTemplateMap = new Map<string, string>();

  const batch = await client.messages.batches.create({
    requests: sorted.map((req) => {
      const type = ATTEMPT_TO_TYPE[req.attemptNumber] ?? "followup_1";
      const tmpl = templateByType.get(type)!;
      const customId = `followup:${req.followUpId}`;
      requestTemplateMap.set(customId, tmpl.id);
      return {
        custom_id: customId,
        params: {
          model: "claude-haiku-4-5",
          max_tokens: maxTokensByType[type],
          system: [{ type: "text" as const, text: tmpl.systemPrompt, cache_control: { type: "ephemeral" as const } }],
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
      const { subject, body, angleTag } = parseResponse(text.text);
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
    .select({
      id: promptTemplates.id,
      systemPrompt: promptTemplates.systemPrompt,
      sendCount: promptTemplates.sendCount,
      positiveIntentCount: promptTemplates.positiveIntentCount,
      negativeReplyCount: promptTemplates.negativeReplyCount,
    })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), eq(promptTemplates.templateType, "initial")));

  if (allTemplates.length === 0) {
    throw new Error("No active initial prompt template — seed a row in prompt_templates with template_type='initial'");
  }

  const template = thompsonSample(allTemplates);
  if (!template) throw new Error("Thompson sampling returned no template");

  const client = new Anthropic({ apiKey });

  console.log(`[drafting] generating ${requests.length} draft(s) (sync)`);

  const settled = await Promise.allSettled(
    requests.map((req) =>
      client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: [{ type: "text" as const, text: template.systemPrompt, cache_control: { type: "ephemeral" as const } }],
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
      const { subject, body, confidenceScore } = parseResponse(text.text);
      results.push({ leadId: req.leadId, campaignId: req.campaignId, templateId: template.id, subject, body, confidenceScore });
    } catch (err) {
      console.error(`[drafting] failed to parse draft for lead ${req.leadId}:`, err);
    }
  }

  console.log(`[drafting] done: ${results.length}/${requests.length} succeeded`);
  return results;
}
