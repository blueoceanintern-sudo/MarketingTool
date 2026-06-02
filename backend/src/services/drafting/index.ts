import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { promptTemplates } from "../../db/schema";

interface LeadContext {
  firstName?: string;
  lastName?: string;
  role?: string;
  companyName?: string;
  industry?: string;
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

interface DraftRequest {
  leadId: string;
  campaignId: string;
  lead: LeadContext;
  campaign?: CampaignContext;
}

interface PickedTemplate {
  id: string;
  systemPrompt: string;
}

// Weighted-random pick across active templates. Weight = relative probability;
// a template with weight 3 is 3× as likely to be picked as one with weight 1.
// Each draft picks independently so a single batch can span multiple templates.
function pickTemplate(active: { id: string; systemPrompt: string; weight: number }[]): PickedTemplate {
  const total = active.reduce((sum, t) => sum + Math.max(t.weight, 0), 0);
  if (total <= 0) {
    const first = active[0]!;
    return { id: first.id, systemPrompt: first.systemPrompt };
  }
  let r = Math.random() * total;
  for (const t of active) {
    r -= Math.max(t.weight, 0);
    if (r <= 0) return { id: t.id, systemPrompt: t.systemPrompt };
  }
  const last = active[active.length - 1]!;
  return { id: last.id, systemPrompt: last.systemPrompt };
}

function buildCampaignBlock(campaign?: CampaignContext): string {
  if (!campaign) return "";
  const lines: string[] = [];
  if (campaign.name) lines.push(`- Campaign: ${campaign.name}`);
  if (campaign.description) lines.push(`- Goal / value proposition: ${campaign.description}`);
  if (campaign.painPoints && campaign.painPoints.length > 0) {
    lines.push("- Pain points to draw from:");
    for (const p of campaign.painPoints) lines.push(`    • ${p}`);
  }
  if (campaign.callToAction) lines.push(`- Preferred call to action: ${campaign.callToAction}`);
  if (lines.length === 0) return "";
  return `\nCampaign context:\n${lines.join("\n")}\n`;
}

function buildUserPrompt(lead: LeadContext, campaign?: CampaignContext): string {
  return `${buildCampaignBlock(campaign)}
Lead details:
- Name: ${lead.firstName ?? "Unknown"} ${lead.lastName ?? ""}
- Role: ${lead.role ?? "Unknown"}
- Company: ${lead.companyName ?? "Unknown"}
- Industry: ${lead.industry ?? "Unknown"}

Write the email now.`;
}

function parseResponse(raw: string): { subject: string; body: string; confidenceScore: number } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in response");

  const parsed = JSON.parse(match[0]) as { subject?: string; body?: string; confidenceScore?: number };

  if (!parsed.subject || !parsed.body || parsed.confidenceScore === undefined) {
    throw new Error("Missing required fields in draft response");
  }

  const wordCount = parsed.body.trim().split(/\s+/).length;
  const score = wordCount > 125 ? Math.max(0, parsed.confidenceScore - 20) : parsed.confidenceScore;

  return { subject: parsed.subject, body: parsed.body, confidenceScore: score };
}

// Follow-up prompt variants by attempt number.
// Attempt 1: simple nudge. Attempt 2: new angle. Attempt 3: break-up email.
function buildFollowUpPrompt(lead: LeadContext, campaign: CampaignContext, attemptNumber: number): string {
  const base = buildCampaignBlock(campaign);
  const leadLine = `Lead: ${lead.firstName ?? "there"} ${lead.lastName ?? ""}, ${lead.role ?? "unknown role"} at ${lead.companyName ?? "their company"}.`;

  const instructions: Record<number, string> = {
    1: "Write a short, friendly follow-up (under 80 words). Acknowledge this is a follow-up to a prior email. Vary the angle slightly — don't repeat the opening line verbatim.",
    2: "Write a follow-up (under 80 words) that introduces one new piece of value or a relevant insight, rather than just nudging. Make it feel like a reason to reply, not a reminder.",
    3: "Write a brief break-up email (under 60 words). Acknowledge you've reached out a couple of times. Keep it light — if now isn't the right time, no problem. Leave the door open.",
  };

  const instruction = instructions[attemptNumber] ?? instructions[1]!;

  return `${base}
${leadLine}

${instruction}

Respond as JSON: { "subject": "...", "body": "...", "confidenceScore": <0-100> }`;
}

// Generates follow-up email content via the Batch API (50% cheaper than sync).
// Uses attempt-number-aware prompts so each attempt has the right tone.
export async function generateFollowUpContent(
  leadId: string,
  campaignId: string,
  lead: LeadContext,
  campaign: CampaignContext,
  attemptNumber: number,
): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const activeTemplates = await db
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt, weight: promptTemplates.weight })
    .from(promptTemplates)
    .where(eq(promptTemplates.active, true));

  if (activeTemplates.length === 0) throw new Error("No active prompt templates");

  const tmpl = pickTemplate(activeTemplates);
  const client = new Anthropic({ apiKey });
  const customId = `followup:${leadId}:${campaignId}:${attemptNumber}`;

  const batch = await client.messages.batches.create({
    requests: [
      {
        custom_id: customId,
        params: {
          model: "claude-haiku-4-5",
          max_tokens: 512,
          system: [{ type: "text", text: tmpl.systemPrompt, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: buildFollowUpPrompt(lead, campaign, attemptNumber) }],
        },
      },
    ],
  });

  let status = batch.processing_status;
  while (status !== "ended") {
    await new Promise((r) => setTimeout(r, 5000));
    const updated = await client.messages.batches.retrieve(batch.id);
    status = updated.processing_status;
  }

  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type !== "succeeded") throw new Error(`Follow-up batch failed: ${JSON.stringify(result.result)}`);
    const text = result.result.message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("No text in follow-up batch result");
    const { subject, body } = parseResponse(text.text);
    return { subject, body };
  }

  throw new Error("Follow-up batch returned no results");
}

export async function generateDraftsBatch(requests: DraftRequest[]): Promise<DraftResult[]> {
  if (requests.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const activeTemplates = await db
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt, weight: promptTemplates.weight })
    .from(promptTemplates)
    .where(eq(promptTemplates.active, true));

  if (activeTemplates.length === 0) {
    throw new Error("No active prompt templates — seed at least one row in prompt_templates");
  }

  const client = new Anthropic({ apiKey });

  // Pick a template per request so a single batch exercises multiple styles
  // when weights spread the probability mass.
  const requestTemplateIds: string[] = [];
  const batchRequests: Anthropic.Messages.MessageCreateParamsNonStreaming[] = requests.map((req) => {
    const tmpl = pickTemplate(activeTemplates);
    requestTemplateIds.push(tmpl.id);
    return {
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: [{ type: "text", text: tmpl.systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserPrompt(req.lead, req.campaign) }],
    };
  });

  // Batch API custom_id has a 64-character limit. Three UUIDs joined by colons
  // would be 110 chars, so we use the request index instead and look up the
  // original lead/campaign/template data by position when parsing results.
  const batch = await client.messages.batches.create({
    requests: batchRequests.map((params, i) => ({ custom_id: String(i), params })),
  });

  console.log(`[drafting] batch ${batch.id}: submitted ${requests.length} request(s), polling...`);

  let status = batch.processing_status;
  while (status !== "ended") {
    await new Promise((r) => setTimeout(r, 5000));
    const updated = await client.messages.batches.retrieve(batch.id);
    status = updated.processing_status;
    if (status !== "ended") console.log(`[drafting] batch ${batch.id}: status=${status}, waiting...`);
  }

  console.log(`[drafting] batch ${batch.id}: complete`);

  const results: DraftResult[] = [];

  for await (const result of await client.messages.batches.results(batch.id)) {
    const idx = parseInt(result.custom_id, 10);
    const req = requests[idx];
    const templateId = requestTemplateIds[idx];

    if (!req || !templateId) {
      console.error(`[drafting] batch result index ${idx} out of range — skipping`);
      continue;
    }

    const { leadId, campaignId } = req;

    if (result.result.type !== "succeeded") {
      console.error(`Draft failed for lead ${leadId}:`, result.result);
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
