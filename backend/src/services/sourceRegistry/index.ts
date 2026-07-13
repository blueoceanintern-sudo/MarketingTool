import { lookup } from "node:dns/promises";
import { inArray, eq, and } from "drizzle-orm";
import { db } from "../../db";
import { sourceRegistry, directoryConfigs, geoPlaces, normalizeVertical } from "../../db/schema";

export interface DirectoryConfig {
  id: string;
  query: string;
  domains: string[];
}

export async function getAllDirectoryConfigs(): Promise<
  Array<DirectoryConfig & { vertical: string; geonameId: number; geoName: string; countryCode: string }>
> {
  const rows = await db
    .select({ config: directoryConfigs, place: geoPlaces })
    .from(directoryConfigs)
    .innerJoin(geoPlaces, eq(directoryConfigs.geonameId, geoPlaces.geonameId))
    .orderBy(directoryConfigs.vertical, geoPlaces.name);
  return rows.map(({ config: r, place }) => ({
    id: r.id,
    vertical: r.vertical,
    geonameId: r.geonameId,
    geoName: place.name,
    countryCode: place.countryCode,
    query: r.query,
    domains: r.domains,
  }));
}

export async function getDirectoryConfig(vertical: string, geonameId: number): Promise<DirectoryConfig | null> {
  const [row] = await db
    .select()
    .from(directoryConfigs)
    .where(
      and(
        eq(directoryConfigs.vertical, normalizeVertical(vertical)),
        eq(directoryConfigs.geonameId, geonameId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { id: row.id, query: row.query, domains: row.domains };
}

export async function hasDirectoryConfig(vertical: string, geonameId: number): Promise<boolean> {
  const config = await getDirectoryConfig(vertical, geonameId);
  return config !== null;
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

export async function discoverSources(
  vertical: string,
  geonameId: number,
  campaignId: string | null,
): Promise<{ inserted: number; sourceIds: string[] }> {
  const key = `${normalizeVertical(vertical)}:${geonameId}`;
  const config = await getDirectoryConfig(vertical, geonameId);

  if (!config) {
    console.warn(`[source-registry] no directory config for ${key} — skipping discovery`);
    return { inserted: 0, sourceIds: [] };
  }

  const results = await tavilySearch(config.query, config.domains);
  if (results.length === 0) return { inserted: 0, sourceIds: [] };

  const candidateUrls = results.map((r) => r.url);
  const existing = await db
    .select({ url: sourceRegistry.url })
    .from(sourceRegistry)
    .where(inArray(sourceRegistry.url, candidateUrls));
  const existingUrls = new Set(existing.map((r) => r.url));

  const novel = results.filter((r) => !existingUrls.has(r.url));
  if (novel.length === 0) return { inserted: 0, sourceIds: [] };

  const validated = await Promise.allSettled(
    novel.map(async (r) => ({ ...r, ok: await validateUrl(r.url) })),
  );

  const sourceIds: string[] = [];
  for (const result of validated) {
    if (result.status !== "fulfilled" || !result.value.ok) continue;
    const { url, title } = result.value;
    try {
      const name = title?.trim() || new URL(url).hostname;
      const [row] = await db
        .insert(sourceRegistry)
        .values({
          name,
          vertical: normalizeVertical(vertical),
          geonameId,
          url,
          scraperType: "cheerio",
          legalFlag: false,
          selectors: {},
          active: true,
          generatedBy: campaignId,
        })
        .onConflictDoNothing()
        .returning({ id: sourceRegistry.id });
      if (row) sourceIds.push(row.id);
    } catch (err) {
      console.error(`[source-registry] failed to insert ${url}:`, err);
    }
  }

  console.log(`[source-registry] ${key}: inserted ${sourceIds.length}/${novel.length} new sources`);
  return { inserted: sourceIds.length, sourceIds };
}
