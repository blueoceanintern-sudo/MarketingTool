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
}

interface DraftRequest {
  leadId: string;
  campaignId: string;
  lead: LeadContext;
  campaign?: CampaignContext;
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
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt, templateType: promptTemplates.templateType })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), inArray(promptTemplates.templateType, neededTypes)));

  const templateByType = new Map(templateRows.map((t) => [t.templateType, t]));

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

  const batch = await client.messages.batches.create({
    requests: sorted.map((req) => {
      const type = ATTEMPT_TO_TYPE[req.attemptNumber] ?? "followup_1";
      const tmpl = templateByType.get(type)!;
      return {
        custom_id: `followup:${req.followUpId}`,
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

  const [template] = await db
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), eq(promptTemplates.templateType, "initial")))
    .limit(1);

  if (!template) {
    throw new Error("No active initial prompt template — seed a row in prompt_templates with template_type='initial'");
  }

  const client = new Anthropic({ apiKey });

  const batch = await client.messages.batches.create({
    requests: requests.map((req) => ({
      custom_id: `${req.leadId}:${req.campaignId}:${template.id}`,
      params: {
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: [{ type: "text" as const, text: template.systemPrompt, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: buildUserPrompt(req.lead, req.campaign) }],
      },
    })),
  });

  let status = batch.processing_status;
  while (status !== "ended") {
    await new Promise((r) => setTimeout(r, 5000));
    const updated = await client.messages.batches.retrieve(batch.id);
    status = updated.processing_status;
  }

  const results: DraftResult[] = [];

  for await (const result of await client.messages.batches.results(batch.id)) {
    const [leadId, campaignId, templateId] = result.custom_id.split(":") as [string, string, string];

    if (result.result.type !== "succeeded") {
      console.error(`Draft failed for ${result.custom_id}:`, result.result);
      continue;
    }

    const text = result.result.message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;

    try {
      const { subject, body, confidenceScore } = parseResponse(text.text);
      results.push({ leadId, campaignId, templateId, subject, body, confidenceScore });
    } catch (err) {
      console.error(`Failed to parse draft for ${result.custom_id}:`, err);
    }
  }

  return results;
}
