CREATE TABLE "directory_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vertical" text NOT NULL,
	"geo" text NOT NULL,
	"query" text NOT NULL,
	"domains" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_configs_vertical_geo_unique" UNIQUE("vertical","geo")
);
--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "mutation_mode" text;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "parent_persuasion_strategy" text;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "child_persuasion_strategy" text;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "dimensions_changed" jsonb;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "mutation_distance" text;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "mutation_reason" text;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "hypothesis_tested" text;