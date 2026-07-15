import { z } from "zod";

export const classificationSchema = z.object({
  category: z.enum(["positive", "negative", "out_of_office", "neutral"]),
  return_date: z.string().nullable(),
  risk_flag: z.boolean(),
});

export type Classification = z.infer<typeof classificationSchema>;
