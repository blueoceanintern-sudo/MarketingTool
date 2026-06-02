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

export interface FollowUpRequest {
  followUpId: string;
  leadId: string;
  campaignId: string;
  lead: LeadContext;
  campaign: CampaignContext;
  attemptNumber: number;
  previousSubjects: string[];
}

export interface FollowUpResult {
  followUpId: string;
  subject: string;
  body: string;
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

function buildFollowUpPrompt(
  lead: LeadContext,
  campaign: CampaignContext,
  attemptNumber: number,
  previousSubjects: string[],
): string {
  const base = buildCampaignBlock(campaign);
  const leadLine = `Lead: ${lead.firstName ?? "there"} ${lead.lastName ?? ""}, ${lead.role ?? "unknown role"} at ${lead.companyName ?? "their company"}.`;

  const instructions: Record<number, string> = {
    1: "Write a short, friendly follow-up (under 80 words). Acknowledge this is a follow-up to a prior email. Vary the angle — don't reuse the previous subject's hook.",
    2: "Write a follow-up (under 80 words) that introduces one new piece of value or a relevant insight. Make it feel like a reason to reply, not a reminder. Avoid angles used in previous emails.",
    3: "Write a brief break-up email (under 60 words). Acknowledge you've reached out a couple of times. Keep it light — if now isn't the right time, no problem. Leave the door open.",
  };

  const instruction = instructions[attemptNumber] ?? instructions[1]!;

  const subjectContext =
    previousSubjects.length > 0
      ? `\nPrevious email subjects (do not reuse these angles):\n${previousSubjects.map((s, i) => `  ${i + 1}. "${s}"`).join("\n")}\n`
      : "";

  return `${base}${subjectContext}
${leadLine}

${instruction}

Respond as JSON: { "subject": "...", "body": "...", "confidenceScore": <0-100> }`;
}

// Batch-generates follow-up content for all pending follow-ups in a single Batch API call.
// Requests are sorted by template ID so consecutive identical system prompts benefit from cache hits.
export async function generateFollowUpBatch(requests: FollowUpRequest[]): Promise<FollowUpResult[]> {
  if (requests.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const activeTemplates = await db
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt, weight: promptTemplates.weight })
    .from(promptTemplates)
    .where(eq(promptTemplates.active, true));

  if (activeTemplates.length === 0) throw new Error("No active prompt templates");

  const client = new Anthropic({ apiKey });

  const withTemplates = requests.map((req) => ({ req, tmpl: pickTemplate(activeTemplates) }));
  withTemplates.sort((a, b) => a.tmpl.id.localeCompare(b.tmpl.id));

  const maxTokensByAttempt: Record<number, number> = { 1: 256, 2: 256, 3: 192 };

  const batch = await client.messages.batches.create({
    requests: withTemplates.map(({ req, tmpl }) => ({
      custom_id: `followup:${req.followUpId}`,
      params: {
        model: "claude-haiku-4-5",
        max_tokens: maxTokensByAttempt[req.attemptNumber] ?? 256,
        system: [{ type: "text", text: tmpl.systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildFollowUpPrompt(req.lead, req.campaign, req.attemptNumber, req.previousSubjects) }],
      },
    })),
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
      const { subject, body } = parseResponse(text.text);
      results.push({ followUpId: result.custom_id.slice("followup:".length), subject, body });
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

  const activeTemplates = await db
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt, weight: promptTemplates.weight })
    .from(promptTemplates)
    .where(eq(promptTemplates.active, true));

  if (activeTemplates.length === 0) {
    throw new Error("No active prompt templates — seed at least one row in prompt_templates");
  }

  const client = new Anthropic({ apiKey });

  // Assign templates first, then sort by template ID so same-template requests are
  // adjacent in the batch — maximizes prompt cache hit rate.
  const withTemplates = requests.map((req) => ({ req, tmpl: pickTemplate(activeTemplates) }));
  withTemplates.sort((a, b) => a.tmpl.id.localeCompare(b.tmpl.id));

  const batch = await client.messages.batches.create({
    requests: withTemplates.map(({ req, tmpl }) => ({
      custom_id: `${req.leadId}:${req.campaignId}:${tmpl.id}`,
      params: {
        model: "claude-haiku-4-5",
        max_tokens: 256,
        system: [{ type: "text", text: tmpl.systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserPrompt(req.lead, req.campaign) }],
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
