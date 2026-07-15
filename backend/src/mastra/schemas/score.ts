import { z } from "zod";

// Raw model scores; the drafting service clamps each to 0–25 locally
// (numeric range constraints aren't supported by structured-output schemas).
export const scoreSchema = z.object({
  painPointFit: z.number(),
  campaignAlignment: z.number(),
  personalisationQuality: z.number(),
});

export type Score = z.infer<typeof scoreSchema>;
