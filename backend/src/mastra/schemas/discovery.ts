import { z } from "zod";

export const discoverySchema = z.object({
  sources: z.array(
    z.object({
      url: z.string(),
      name: z.string(),
      scraperType: z.enum(["crawl4ai", "cheerio"]),
      legalFlag: z.boolean(),
      rationale: z.string(),
    }),
  ),
  queriesRun: z.array(z.string()),
});

export type DiscoveryResult = z.infer<typeof discoverySchema>;
