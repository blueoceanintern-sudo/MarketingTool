import { z } from "zod";

export const planSchema = z.object({
  name: z.string(),
  vertical: z.string(),
  geonameIds: z.array(z.number()),
  companySizeTarget: z.enum(["small", "medium", "large", "enterprise", "unknown"]),
  description: z.string(),
  painPoints: z.array(z.string()),
  callToAction: z.string(),
  // Populated instead of (or alongside) the above when the brief is ambiguous
  // or incomplete. Each entry is a specific question to ask the user.
  // If this array is non-empty, the route returns 422 and no campaign is created.
  clarificationNeeded: z.array(z.string()).optional(),
});

export type CampaignPlan = z.infer<typeof planSchema>;
