import { db } from "../../db";
import { promptTemplates, emailDrafts, leads, companies } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { mutatorAgent } from "../../mastra/agents/mutator.agent";
import { mutationResponseSchema } from "../../mastra/schemas/mutation";

export interface MutationResult {
  name: string;
  description: string;
  systemPrompt: string;
  mutationMode: "refine" | "replace";
  parentPersuasionStrategy: string;
  childPersuasionStrategy: string;
  dimensionsChanged: string[];
  mutationDistance: string;
  mutationReason: string;
  hypothesisTested: string;
}

interface Template {
  id: string;
  sendCount: number;
  positiveIntentCount: number;
  systemPrompt: string;
  description?: string | null;
}

// --- Utilities ---

const sanitizeForPrompt = (text: string): string => text;

const formatRate = (count: number, total: number): string => {
  if (total === 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
};

// --- Prompts ---

const getReplacePrompt = (
  parent: Template,
  positiveRate: string,
  industryList: string,
): string => `
You are creating a variation of an outbound B2B cold email prompt template.
This parent template is underperforming. Your goal is to test a genuinely new hypothesis.

## Parent template performance
- Send count: ${parent.sendCount}
- Positive intent rate: ${positiveRate} (${parent.positiveIntentCount} positive replies)
- Industries reached: ${industryList}
- Current angle/approach: ${parent.description ?? "not specified"}

## Parent template system_prompt
${sanitizeForPrompt(parent.systemPrompt)}

## Step 1 — Extract constraints
Before writing anything, extract the following from the parent system_prompt exactly as written:

{
  "preserved_constraints": {
    "word_limit": "exact word limit stated in parent",
    "placeholders": ["every {{variable}} present"],
    "format_rules": ["every formatting rule e.g. no bullet points, active voice"],
    "hard_rules": ["every hard rule e.g. no competitors, no fabricated stats"],
    "target_persona": "role and industry targeting as stated"
  }
}

These constraints must be copied verbatim into the child system_prompt. Do not modify, omit, or reinterpret them.

## Step 2 — Analyze the parent
Identify:
- Primary persuasion strategy (from taxonomy below)
- Most likely reason for underperformance

Keep this brief. You need a diagnosis, not an essay.

## Step 3 — Generate the child
1. Select a GENUINELY DIFFERENT persuasion strategy from the taxonomy. Do not retain the parent's strategy.
2. Write a NEW system_prompt that adopts the new strategy and changes at least FOUR dimensions from the available list.
3. Apply all preserved_constraints verbatim.

## Persuasion strategy taxonomy
- pain/problem — fixing a broken or painful workflow
- revenue_growth — increasing pipeline or sales output
- efficiency/time_savings — doing the same work faster
- risk_reduction — preventing loss, churn, or downside
- social_proof — leveraging what peers are already doing
- competitive_pressure — risk of falling behind competitors
- compliance/regulation — meeting legal or regulatory frameworks
- customer_experience — retaining or delighting end users
- talent/workforce — hiring, retention, or team productivity
- strategic_initiative — aligning with board or exec-level goals
- operational_visibility — gaining data, reporting, or insight

## Dimensions available to change
- opening pattern
- proof mechanism
- CTA framing
- benefit framing
- narrative structure
- example type

## Forbidden
- Retaining the same persuasion strategy as the parent
- Superficial changes — synonym swaps or reordered sentences do not count
- Modifying any extracted preserved_constraints
- Fabricating statistics, clients, or testimonials not in the parent

## Output format
Return raw JSON only. No preamble, no postscript, no markdown fences.
Escape all internal quotes as \\" and newlines as \\n within string values.

{
  "preserved_constraints": {
    "word_limit": "...",
    "placeholders": ["..."],
    "format_rules": ["..."],
    "hard_rules": ["..."],
    "target_persona": "..."
  },
  "analysis_summary": {
    "parent_persuasion_strategy": "from taxonomy",
    "parent_opening_pattern": "one sentence",
    "parent_proof_mechanism": "one sentence",
    "parent_cta_framing": "one sentence",
    "parent_benefit_framing": "one sentence",
    "failure_hypothesis": "one sentence: most likely cause of underperformance",
    "recommended_action": "replace",
    "confidence": 0.0
  },
  "hypothesis_tested": "one sentence: the new theory being tested",
  "expected_outcome": {
    "confidence": 0.0,
    "reason": "one sentence: why this strategy should outperform for this persona"
  },
  "name": "short descriptive name (max 60 chars)",
  "description": "one sentence describing the new angle",
  "system_prompt": "full child system_prompt with all preserved_constraints applied verbatim",
  "mutation_metadata": {
    "parent_template_id": "${parent.id}",
    "mutation_mode": "replace",
    "parent_persuasion_strategy": "matches analysis_summary",
    "child_persuasion_strategy": "new strategy from taxonomy",
    "dimensions_changed": ["dim 1", "dim 2", "dim 3", "dim 4"],
    "mutation_distance": "high",
    "mutation_reason": "one sentence: why this hypothesis is worth testing"
  }
}`;

const getRefinePrompt = (
  parent: Template,
  positiveRate: string,
  industryList: string,
  mutationSize: 1 | 2,
): string => `
You are creating a variation of an outbound B2B cold email prompt template.
This parent template is performing well. Your goal is to improve execution within the winning strategy.
Novelty is not the objective. Incremental improvement is the objective.

## Parent template performance
- Send count: ${parent.sendCount}
- Positive intent rate: ${positiveRate} (${parent.positiveIntentCount} positive replies)
- Industries reached: ${industryList}
- Current angle/approach: ${parent.description ?? "not specified"}

## Parent template system_prompt
${sanitizeForPrompt(parent.systemPrompt)}

## Step 1 — Extract constraints
Before writing anything, extract the following from the parent system_prompt exactly as written:

{
  "preserved_constraints": {
    "word_limit": "exact word limit stated in parent",
    "placeholders": ["every {{variable}} present"],
    "format_rules": ["every formatting rule"],
    "hard_rules": ["every hard rule"],
    "target_persona": "role and industry targeting as stated"
  }
}

These constraints must be copied verbatim into the child system_prompt. Do not modify, omit, or reinterpret them.

## Step 2 — Analyze the parent
Identify:
- Primary persuasion strategy (from taxonomy below)
- The 1-3 elements most likely responsible for its performance — these must be preserved exactly
- Which dimensions are safe to change without disrupting the winning elements

Keep this brief.

## Step 3 — Generate the child
1. Preserve the same primary persuasion strategy and industry targeting assumptions.
2. Clone the parent system_prompt structure. Modify EXACTLY ${mutationSize} dimension${mutationSize > 1 ? "s" : ""} from the available list — no more, no less.
3. Focus only on: making the hook punchier, reducing CTA friction, or increasing proof specificity.
4. Apply all preserved_constraints verbatim.

## Persuasion strategy taxonomy
- pain/problem — fixing a broken or painful workflow
- revenue_growth — increasing pipeline or sales output
- efficiency/time_savings — doing the same work faster
- risk_reduction — preventing loss, churn, or downside
- social_proof — leveraging what peers are already doing
- competitive_pressure — risk of falling behind competitors
- compliance/regulation — meeting legal or regulatory frameworks
- customer_experience — retaining or delighting end users
- talent/workforce — hiring, retention, or team productivity
- strategic_initiative — aligning with board or exec-level goals
- operational_visibility — gaining data, reporting, or insight

## Dimensions available to change
- opening pattern
- proof mechanism
- CTA framing
- example type
- narrative structure

## Forbidden
- Changing the primary persuasion strategy
- Changing industry targeting assumptions or target persona
- Modifying the elements identified as responsible for performance
- Superficial edits — synonym swaps do not count as dimension changes
- Changing more than ${mutationSize} dimension${mutationSize > 1 ? "s" : ""}
- Introducing new hard rules or tone shifts not in the parent
- Modifying any extracted preserved_constraints

## Output format
Return raw JSON only. No preamble, no postscript, no markdown fences.
Escape all internal quotes as \\" and newlines as \\n within string values.

{
  "preserved_constraints": {
    "word_limit": "...",
    "placeholders": ["..."],
    "format_rules": ["..."],
    "hard_rules": ["..."],
    "target_persona": "..."
  },
  "analysis_summary": {
    "parent_persuasion_strategy": "from taxonomy",
    "parent_opening_pattern": "one sentence",
    "parent_proof_mechanism": "one sentence",
    "parent_cta_framing": "one sentence",
    "parent_benefit_framing": "one sentence",
    "success_factors": ["element 1 driving performance", "element 2"],
    "recommended_action": "refine",
    "confidence": 0.0
  },
  "hypothesis_tested": "one sentence: the execution improvement being tested",
  "expected_outcome": {
    "confidence": 0.0,
    "reason": "one sentence: why this change should improve performance"
  },
  "name": "short descriptive name (max 60 chars)",
  "description": "one sentence: what was changed and why",
  "system_prompt": "full child system_prompt with all preserved_constraints applied verbatim",
  "mutation_metadata": {
    "parent_template_id": "${parent.id}",
    "mutation_mode": "refine",
    "parent_persuasion_strategy": "matches analysis_summary",
    "child_persuasion_strategy": "must match parent_persuasion_strategy",
    "dimensions_changed": ["dim 1"],
    "mutation_distance": "low | medium",
    "mutation_reason": "one sentence: what execution improvement this tests"
  }
}`;

// --- Prompt selection ---

function getMutationPrompt(
  parent: Template,
  positiveRate: string,
  industryList: string,
  rankedTemplates: Template[],
): string | null {
  const total = rankedTemplates.length;
  // Need at least 2 to compute a meaningful percentile
  if (total < 2) return null;

  const idx = rankedTemplates.findIndex((t) => t.id === parent.id);
  if (idx === -1) return null;

  const percentile = idx / (total - 1);

  const isTopTier = percentile <= 0.05;
  const isWinner = percentile <= 0.25;
  const isLoser = percentile >= 0.75;

  // Top tier always gets the most conservative refine — don't gamble on the best performer
  if (isTopTier) return getRefinePrompt(parent, positiveRate, industryList, 1);
  // 20% diversity budget on 5–25% tier only — prevents lineage convergence without risking the top
  if (isWinner && Math.random() < 0.2) return getReplacePrompt(parent, positiveRate, industryList);
  if (isWinner) return getRefinePrompt(parent, positiveRate, industryList, 2);
  if (isLoser) return getReplacePrompt(parent, positiveRate, industryList);

  return null; // middle 50% — skip
}

// --- Main export ---

export async function generateMutation(
  parentId: string,
  rankedTemplates: Template[],
): Promise<MutationResult | null> {
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

  const industryList =
    industryRows.map((r) => `${r.industry} (${r.count})`).join(", ") || "not yet tracked";

  const positiveRate = formatRate(parent.positiveIntentCount, parent.sendCount);

  const parentAsTemplate: Template = {
    id: parent.id,
    sendCount: parent.sendCount,
    positiveIntentCount: parent.positiveIntentCount,
    systemPrompt: parent.systemPrompt,
    description: parent.description,
  };

  const prompt = getMutationPrompt(parentAsTemplate, positiveRate, industryList, rankedTemplates);
  if (!prompt) {
    console.log(`[mutator] template "${parent.name}" is in middle tier — skipping`);
    return null;
  }

  try {
    const response = await mutatorAgent.generate(prompt, {
      structuredOutput: { schema: mutationResponseSchema, errorStrategy: "strict" },
      modelSettings: { maxOutputTokens: 4096 },
    });

    const parsed = response.object;
    if (!parsed || !parsed.name || !parsed.system_prompt) return null;
    const metadata = parsed.mutation_metadata ?? {};

    return {
      name: parsed.name,
      description: parsed.description ?? "",
      systemPrompt: parsed.system_prompt,
      mutationMode: metadata.mutation_mode ?? "replace",
      parentPersuasionStrategy: metadata.parent_persuasion_strategy ?? "",
      childPersuasionStrategy: metadata.child_persuasion_strategy ?? "",
      dimensionsChanged: metadata.dimensions_changed ?? [],
      mutationDistance: metadata.mutation_distance ?? "",
      mutationReason: metadata.mutation_reason ?? "",
      hypothesisTested: parsed.hypothesis_tested ?? "",
    };
  } catch (err) {
    console.error("[mutator] generation failed:", err);
    return null;
  }
}
