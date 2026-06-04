import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db";
import { promptTemplates, emailDrafts, leads, companies } from "../../db/schema";
import { eq, sql } from "drizzle-orm";

const client = new Anthropic();

export interface MutationResult {
  name: string;
  description: string;
  systemPrompt: string;
}

export async function generateMutation(parentId: string): Promise<MutationResult | null> {
  const [parent] = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.id, parentId))
    .limit(1);

  if (!parent) return null;

  const industryRows = await db
    .select({
      industry: companies.industry,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(emailDrafts)
    .innerJoin(leads, eq(emailDrafts.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(eq(emailDrafts.templateId, parentId))
    .groupBy(companies.industry);

  const industryList = industryRows.map((r) => `${r.industry} (${r.count})`).join(", ") || "not yet tracked";

  const positiveRate =
    parent.sendCount > 0
      ? `${((parent.positiveIntentCount / parent.sendCount) * 100).toFixed(1)}%`
      : "0.0%";

  const prompt = `You are creating a variation of an outbound B2B cold email prompt template.

## Parent template performance
- Send count: ${parent.sendCount}
- Positive intent rate: ${positiveRate} (${parent.positiveIntentCount} positive replies)
- Industries reached: ${industryList}
- Current angle/approach: ${parent.description ?? "not specified"}

## Parent template system_prompt
${parent.systemPrompt}

## Your task
Write a NEW system_prompt that:
1. Uses a DIFFERENT operational angle than the parent — different hook, different opening, different concrete example, different benefit framing. Reframe, do not rephrase.
2. Copies ALL hard rules, structural constraints, word count limits, and formatting requirements from the parent verbatim.
3. Does NOT produce the same opening sentence, the same type of example, or the same structure as the parent.

Return only valid JSON. No explanation, no preamble, no markdown fences.

{
  "name": "short descriptive name for this variant (max 60 chars)",
  "description": "one sentence describing the new angle used",
  "system_prompt": "the full new system prompt"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;

    const match = text.text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as {
      name?: string;
      description?: string;
      system_prompt?: string;
    };

    if (!parsed.name || !parsed.system_prompt) return null;

    return {
      name: parsed.name,
      description: parsed.description ?? "",
      systemPrompt: parsed.system_prompt,
    };
  } catch (err) {
    console.error("[mutator] generation failed:", err);
    return null;
  }
}
