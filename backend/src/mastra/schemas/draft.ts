import { z } from "zod";

// Matches the JSON shape the drafting templates instruct the model to emit.
export const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  angle_tag: z.string().nullish(),
});

export type Draft = z.infer<typeof draftSchema>;
