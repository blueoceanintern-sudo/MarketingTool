ALTER TABLE "prompt_templates" ADD COLUMN "mutation_mode" text;
ALTER TABLE "prompt_templates" ADD COLUMN "parent_persuasion_strategy" text;
ALTER TABLE "prompt_templates" ADD COLUMN "child_persuasion_strategy" text;
ALTER TABLE "prompt_templates" ADD COLUMN "dimensions_changed" jsonb;
ALTER TABLE "prompt_templates" ADD COLUMN "mutation_distance" text;
ALTER TABLE "prompt_templates" ADD COLUMN "mutation_reason" text;
ALTER TABLE "prompt_templates" ADD COLUMN "hypothesis_tested" text;
