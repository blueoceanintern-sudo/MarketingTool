import { lookup } from "node:dns/promises";
import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { sourceRegistry, normalizeVertical, normalizeGeo } from "../../db/schema";

export interface DirectoryConfig {
  query: string;
  domains: string[];
}

// Add a new entry here when onboarding a new vertical or market.
// domains → passed to Tavily as include_domains (restricts results to those sites).
// query  → search terms used within those domains.
export const DIRECTORY_CONFIGS: Record<string, DirectoryConfig> = {
  "education:SG": {
    query: "Singapore school contact principal",
    domains: ["moe.edu.sg", "cpe.gov.sg"],
  },
  "education:AU": {
    query: "school contact principal email",
    domains: ["myschool.edu.au", "acara.edu.au", "asqa.gov.au", "teqsa.gov.au"],
  },
  "education:US": {
    query: "school contact email",
    domains: ["nces.ed.gov", "ed.gov"],
  },
};

// Whether (vertical, geo) has a Tavily directory config. Callers use this to
// distinguish "discovery skipped because no config" from "discovery ran and
// found nothing." Routes can also expose this so UIs can show coverage.
export function hasDirectoryConfig(vertical: string, geo: string): boolean {
  const key = `${normalizeVertical(vertical)}:${resolveGeo(geo)}`;
  return key in DIRECTORY_CONFIGS;
}

export function getDirectoryConfig(vertical: string, geo: string): DirectoryConfig | null {
  const key = `${normalizeVertical(vertical)}:${resolveGeo(geo)}`;
  return DIRECTORY_CONFIGS[key] ?? null;
}

const PRIVATE_IP_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1$|0\.0\.0\.0)/;

async function isSsrfSafe(urlStr: string): Promise<boolean> {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname;
    if (PRIVATE_IP_RE.test(hostname) || hostname === "localhost") return false;
    const { address } = await lookup(hostname);
    return !PRIVATE_IP_RE.test(address);
  } catch {
    return false;
  }
}

const BLOCKED_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|png|jpg|jpeg|gif|svg|mp4|mp3)$/i;

async function validateUrl(urlStr: string): Promise<boolean> {
  const safe = await isSsrfSafe(urlStr);
  if (!safe) return false;
  if (BLOCKED_EXTENSIONS.test(new URL(urlStr).pathname)) return false;
  try {
    const res = await fetch(urlStr, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return false;
    return res.status < 500;
  } catch {
    return false;
  }
}

async function tavilySearch(query: string, domains: string[]): Promise<{ url: string; title: string }[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 10,
      search_depth: "basic",
      include_answer: false,
      include_domains: domains,
    }),
  });

  if (!res.ok) throw new Error(`Tavily API error: ${res.status}`);
  const data = await res.json() as { results: { url: string; title: string }[] };
  return data.results ?? [];
}

const GEO_ALIASES: Record<string, string> = {
  AUSTRALIA: "AU",
  SINGAPORE: "SG",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  USA: "US",
};

function resolveGeo(geo: string): string {
  const upper = normalizeGeo(geo);
  return GEO_ALIASES[upper] ?? upper;
}

export async function discoverSources(
  vertical: string,
  geo: string,
  campaignId: string | null,
): Promise<number> {
  const key = `${normalizeVertical(vertical)}:${resolveGeo(geo)}`;
  const config = DIRECTORY_CONFIGS[key];

  if (!config) {
    console.warn(`[source-registry] no directory config for ${key} — skipping discovery`);
    return 0;
  }

  const results = await tavilySearch(config.query, config.domains);
  if (results.length === 0) return 0;

  // Load only candidate URLs to check for duplicates — avoid a full table scan
  const candidateUrls = results.map((r) => r.url);
  const existing = await db
    .select({ url: sourceRegistry.url })
    .from(sourceRegistry)
    .where(inArray(sourceRegistry.url, candidateUrls));
  const existingUrls = new Set(existing.map((r) => r.url));

  const novel = results.filter((r) => !existingUrls.has(r.url));
  if (novel.length === 0) return 0;

  // Validate all candidate URLs in parallel
  const validated = await Promise.allSettled(
    novel.map(async (r) => ({ ...r, ok: await validateUrl(r.url) })),
  );

  let inserted = 0;
  for (const result of validated) {
    if (result.status !== "fulfilled" || !result.value.ok) continue;
    const { url, title } = result.value;
    try {
      const name = title?.trim() || new URL(url).hostname;
      await db
        .insert(sourceRegistry)
        .values({
          name,
          vertical: normalizeVertical(vertical),
          geo: normalizeGeo(geo),
          url,
          scraperType: "cheerio",
          legalFlag: false,
          selectors: {},
          active: true,
          generatedBy: campaignId,
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      console.error(`[source-registry] failed to insert ${url}:`, err);
    }
  }

  console.log(`[source-registry] ${key}: inserted ${inserted}/${novel.length} new sources`);
  return inserted;
}
