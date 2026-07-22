import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const webSearchTool = createTool({
  id: "web_search",
  description:
    "Search the web for lead source directories. Returns page titles, URLs, and content snippets. Call multiple times with diverse queries to maximise coverage.",
  inputSchema: z.object({
    query: z.string().describe("Search query targeting a specific type of directory or membership list"),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY not set");

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 10,
        search_depth: "advanced",
        include_answer: false,
      }),
    });

    if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
    const data = (await res.json()) as {
      results: { url: string; title: string; content: string }[];
    };
    return { results: data.results ?? [] };
  },
});
