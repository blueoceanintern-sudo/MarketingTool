import { z } from "zod";

// Mirrors the full output format the mutation prompts specify. The service
// consumes name/description/system_prompt/hypothesis_tested/mutation_metadata;
// the analysis blocks stay in the schema so the prompt's chain-of-work
// (extract constraints → analyze → generate) is preserved under structured output.
const preservedConstraintsSchema = z.object({
  word_limit: z.string(),
  placeholders: z.array(z.string()),
  format_rules: z.array(z.string()),
  hard_rules: z.array(z.string()),
  target_persona: z.string(),
});

export const mutationResponseSchema = z.object({
  preserved_constraints: preservedConstraintsSchema.nullish(),
  analysis_summary: z
    .object({
      parent_persuasion_strategy: z.string(),
      parent_opening_pattern: z.string(),
      parent_proof_mechanism: z.string(),
      parent_cta_framing: z.string(),
      parent_benefit_framing: z.string(),
      failure_hypothesis: z.string().nullish(),
      success_factors: z.array(z.string()).nullish(),
      recommended_action: z.string(),
      confidence: z.number(),
    })
    .nullish(),
  hypothesis_tested: z.string(),
  expected_outcome: z
    .object({
      confidence: z.number(),
      reason: z.string(),
    })
    .nullish(),
  name: z.string(),
  description: z.string(),
  system_prompt: z.string(),
  mutation_metadata: z.object({
    parent_template_id: z.string(),
    mutation_mode: z.enum(["refine", "replace"]),
    parent_persuasion_strategy: z.string(),
    child_persuasion_strategy: z.string(),
    dimensions_changed: z.array(z.string()),
    mutation_distance: z.string(),
    mutation_reason: z.string(),
  }),
});

export type MutationResponse = z.infer<typeof mutationResponseSchema>;
