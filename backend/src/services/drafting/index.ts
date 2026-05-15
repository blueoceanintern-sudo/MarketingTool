import Anthropic from "@anthropic-ai/sdk";

type Persona = "technical" | "executive" | "ops";

interface LeadContext {
  firstName?: string;
  lastName?: string;
  role?: string;
  companyName?: string;
  industry?: string;
}

export interface DraftResult {
  leadId: string;
  campaignId: string;
  persona: Persona;
  subject: string;
  body: string;
  confidenceScore: number;
}

interface DraftRequest {
  leadId: string;
  campaignId: string;
  persona: Persona;
  lead: LeadContext;
}

const PERSONA_PROMPTS: Record<Persona, string> = {
  technical: `You write outbound B2B emails from the perspective of a technical solutions consultant.
Focus on: implementation pain points, integration complexity, developer productivity, technical debt.
Tone: peer-to-peer, direct, no fluff.`,

  executive: `You write outbound B2B emails from the perspective of a business development executive.
Focus on: ROI, revenue impact, competitive advantage, strategic outcomes.
Tone: concise, confident, outcome-driven.`,

  ops: `You write outbound B2B emails from the perspective of an operations efficiency specialist.
Focus on: process efficiency, time savings, workflow automation, team capacity.
Tone: practical, results-focused, empathetic to day-to-day friction.`,
};

const SYSTEM_PROMPT = `You are an expert B2B cold email writer. Given a lead's details and a persona,
write a short personalised outreach email.

Rules:
- Maximum 125 words in the email body
- Subject line: under 10 words, no clickbait
- Use only the lead fields provided — never invent details
- End with one clear call to action (a short call or 15-min chat)
- No unsubscribe links (added by sender service)
- No pricing, no free trial offers

Respond in this exact JSON format:
{
  "subject": "...",
  "body": "...",
  "confidenceScore": <integer 0-100>
}

confidenceScore reflects how well the email fits the lead context (100 = perfect fit, low = missing key fields).`;

function buildUserPrompt(lead: LeadContext, persona: Persona): string {
  return `Persona context: ${PERSONA_PROMPTS[persona]}

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

export async function generateDraftsBatch(requests: DraftRequest[]): Promise<DraftResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const client = new Anthropic({ apiKey });

  const batchRequests: Anthropic.Messages.MessageCreateParamsNonStreaming[] = requests.map((req) => ({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserPrompt(req.lead, req.persona) }],
  }));

  const batch = await client.messages.batches.create({
    requests: batchRequests.map((params, i) => {
      const req = requests[i]!;
      return { custom_id: `${req.leadId}:${req.campaignId}:${req.persona}`, params };
    }),
  });

  // Poll until complete
  let status = batch.processing_status;
  let batchId = batch.id;
  while (status !== "ended") {
    await new Promise((r) => setTimeout(r, 5000));
    const updated = await client.messages.batches.retrieve(batchId);
    status = updated.processing_status;
  }

  const results: DraftResult[] = [];

  for await (const result of await client.messages.batches.results(batchId)) {
    const [leadId, campaignId, persona] = result.custom_id.split(":") as [string, string, Persona];

    if (result.result.type !== "succeeded") {
      console.error(`Draft failed for ${result.custom_id}:`, result.result);
      continue;
    }

    const text = result.result.message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;

    try {
      const { subject, body, confidenceScore } = parseResponse(text.text);
      results.push({ leadId, campaignId, persona, subject, body, confidenceScore });
    } catch (err) {
      console.error(`Failed to parse draft for ${result.custom_id}:`, err);
    }
  }

  return results;
}
