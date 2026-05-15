import { Hono } from "hono";
import { suppressionList } from "./replies";
import { sourceRegistry } from "../config/sourceRegistry";

type ScraperType = "crawl4ai" | "cheerio" | "api";

interface RegistrySource {
  id: string;
  name: string;
  vertical: string;
  geo: string;
  url: string;
  scraperType: ScraperType;
  legalFlag: boolean;
  selectors: Record<string, string>;
  active: boolean;
  createdAt: string;
}

type SuppressionReason = "unsubscribed" | "spam_complaint" | "hostile" | "manual";

interface SuppressionEntry {
  email: string;
  reason: SuppressionReason;
  addedAt: string;
}

const registrySources = new Map<string, RegistrySource>(
  Object.entries(sourceRegistry).map(([name, selectors]) => {
    const id = crypto.randomUUID();
    return [
      id,
      {
        id,
        name,
        vertical: "generic",
        geo: "global",
        url: "",
        scraperType: "cheerio",
        legalFlag: false,
        selectors,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ];
  })
);

const suppressionEntries = new Map<string, SuppressionEntry>();

export const adminRouter = new Hono();

adminRouter.get("/registry/sources", (c) => {
  return c.json(Array.from(registrySources.values()));
});

adminRouter.post("/registry/sources", async (c) => {
  const body = await c.req.json<Omit<RegistrySource, "id" | "createdAt">>();

  if (!body.name || !body.vertical || !body.geo || !body.url || !body.scraperType) {
    return c.json({ error: "name, vertical, geo, url, scraperType are required" }, 400);
  }

  const source: RegistrySource = {
    ...body,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  registrySources.set(source.id, source);
  return c.json(source, 201);
});

adminRouter.get("/suppression", (c) => {
  const entries = Array.from(suppressionEntries.values());
  const fromReplies = Array.from(suppressionList).map((email) => ({
    email,
    reason: "unsubscribed" as SuppressionReason,
    addedAt: new Date().toISOString(),
  }));

  const all = [...entries, ...fromReplies.filter((r) => !suppressionEntries.has(r.email))];
  return c.json(all);
});

adminRouter.post("/suppression", async (c) => {
  const body = await c.req.json<{ email: string; reason: SuppressionReason }>();

  if (!body.email || !body.reason) {
    return c.json({ error: "email and reason are required" }, 400);
  }

  const entry: SuppressionEntry = {
    email: body.email,
    reason: body.reason,
    addedAt: new Date().toISOString(),
  };

  suppressionList.add(body.email);
  suppressionEntries.set(body.email, entry);
  return c.json(entry, 201);
});
