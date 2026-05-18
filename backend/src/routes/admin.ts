import { Hono } from "hono";
import { db } from "../db";
import { sourceRegistry, suppressionList } from "../db/schema";
import { eq } from "drizzle-orm";

export const adminRouter = new Hono();

adminRouter.get("/registry/sources", async (c) => {
  const rows = await db.select().from(sourceRegistry).orderBy(sourceRegistry.createdAt);
  return c.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    vertical: r.vertical,
    geo: r.geo,
    url: r.url,
    scraper_type: r.scraperType,
    legal_flag: r.legalFlag,
    selectors: r.selectors,
    active: r.active,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  })));
});

adminRouter.post("/registry/sources", async (c) => {
  const body = await c.req.json<{
    name?: string;
    vertical?: string;
    geo?: string;
    url?: string;
    scraper_type?: string;
    legal_flag?: boolean;
    selectors?: Record<string, string>;
    active?: boolean;
  }>();

  if (!body.name || !body.vertical || !body.geo || !body.url || !body.scraper_type) {
    return c.json({ error: "name, vertical, geo, url, scraper_type are required" }, 400);
  }

  const scraperType = body.scraper_type as "crawl4ai" | "cheerio" | "api";

  const [row] = await db
    .insert(sourceRegistry)
    .values({
      name: body.name,
      vertical: body.vertical,
      geo: body.geo,
      url: body.url,
      scraperType,
      legalFlag: body.legal_flag ?? false,
      selectors: body.selectors ?? {},
      active: body.active ?? true,
    })
    .returning();

  return c.json(row, 201);
});

adminRouter.get("/suppression", async (c) => {
  const rows = await db.select().from(suppressionList).orderBy(suppressionList.addedAt);
  return c.json(rows.map((r) => ({
    id: r.id,
    email: r.email,
    reason: r.reason,
    added_at: r.addedAt.toISOString(),
  })));
});

adminRouter.post("/suppression", async (c) => {
  const body = await c.req.json<{ email?: string; reason?: string }>();

  if (!body.email || !body.reason) {
    return c.json({ error: "email and reason are required" }, 400);
  }

  const reason = body.reason as "unsubscribed" | "spam_complaint" | "hostile" | "manual";

  const [row] = await db
    .insert(suppressionList)
    .values({ email: body.email, reason })
    .onConflictDoNothing()
    .returning();

  if (!row) return c.json({ message: "Email already suppressed" }, 200);
  return c.json({ id: row.id, email: row.email, reason: row.reason, added_at: row.addedAt.toISOString() }, 201);
});
